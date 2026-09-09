//! Ingestion pipeline: Rust orchestrates and owns every Postgres write: the
//! Python intelligence service is called as a stateless computation step at
//! each stage and never touches the database directly.

use crate::db;
use crate::intelligence::*;
use crate::state::AppState;
use serde_json::json;
use std::path::Path;
use uuid::Uuid;

fn normalized_key(name: &str) -> String {
    name.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

pub async fn run_ingestion(state: AppState, document_id: Uuid, path: String) {
    if let Err(err) = run_ingestion_inner(&state, document_id, &path).await {
        tracing::error!(%document_id, error = %err, "ingestion pipeline failed");
        let _ = db::set_document_status(&state.db, document_id, "failed", None).await;
        let _ = db::fail_running_jobs(&state.db, document_id, &err.to_string()).await;
    }
}

async fn run_ingestion_inner(state: &AppState, document_id: Uuid, path: &str) -> anyhow::Result<()> {
    let db_pool = &state.db;
    let client = &state.intelligence;

    // ---- stage: extract_text ----
    let job = db::create_job(db_pool, document_id, "extract_text").await?;
    let extracted = client
        .extract_pages(&ExtractPagesRequest { document_id: document_id.to_string(), path: path.to_string() })
        .await?;
    for page in &extracted.pages {
        db::insert_page(
            db_pool, document_id, page.page_number, &page.extraction_method, &page.text,
            page.confidence, page.layout.clone(),
        ).await?;
    }
    db::set_document_status(db_pool, document_id, "processing", Some(extracted.page_count)).await?;
    db::finish_job(db_pool, job.id, "done", None, json!({"pages": extracted.pages.len()})).await?;

    // ---- stage: chunk ----
    let job = db::create_job(db_pool, document_id, "chunk").await?;
    let page_inputs: Vec<PageInput> = extracted.pages.iter()
        .map(|p| PageInput { page_number: p.page_number, text: p.text.clone() })
        .collect();
    let built = client.build_chunks(&BuildChunksRequest { document_id: document_id.to_string(), pages: page_inputs }).await?;
    db::finish_job(db_pool, job.id, "done", None, json!({"chunks": built.chunks.len()})).await?;

    // ---- stage: embed + persist chunks ----
    let job = db::create_job(db_pool, document_id, "embed").await?;
    let texts: Vec<String> = built.chunks.iter().map(|c| c.text.clone()).collect();
    let embeddings = if texts.is_empty() {
        EmbedResponse { embeddings: vec![], dim: 0, model: "n/a".into() }
    } else {
        client.embed(texts).await?
    };
    let mut chunk_ids = Vec::with_capacity(built.chunks.len());
    for (i, c) in built.chunks.iter().enumerate() {
        let emb = embeddings.embeddings.get(i).cloned();
        let row = db::insert_chunk(
            db_pool, document_id, c.page_start, c.page_end, &c.text, c.char_start, c.char_end, c.token_count, emb,
        ).await?;
        chunk_ids.push(row.id);
    }
    db::finish_job(db_pool, job.id, "done", None, json!({"embedded": built.chunks.len(), "model": embeddings.model})).await?;

    // ---- stage: extract_facts (+ resolve_entities + normalize, inline per fact) ----
    let job = db::create_job(db_pool, document_id, "extract_facts").await?;

    let mut new_fact_ids: Vec<Uuid> = Vec::new();
    let mut dropped_total = 0i32;
    let mut chunk_errors = 0i32;
    let mut sample_error: Option<String> = None;

    for (i, c) in built.chunks.iter().enumerate() {
        let chunk_id = chunk_ids[i];
        // Re-fetched every chunk (cheap relative to the LLM call): a
        // predicate created by an earlier chunk in this same document must
        // be visible to later chunks, or near-duplicate predicates for the
        // same concept pile up within a single document (observed in
        // practice: "pat_loss", "PAT_loss_previous", "PAT_loss_reduction"
        // all appeared for what should have been one canonical predicate).
        let known_predicates: Vec<KnownPredicate> = db::list_predicates(db_pool).await?.into_iter()
            .map(|p| KnownPredicate { canonical_name: p.canonical_name, aliases: p.aliases })
            .collect();
        let resp = client.extract_facts(&ExtractFactsRequest {
            document_id: document_id.to_string(),
            chunk: ChunkInput { id: chunk_id.to_string(), text: c.text.clone(), page_start: c.page_start, page_end: c.page_end },
            known_predicates,
        }).await?;
        dropped_total += resp.dropped_ungrounded;
        if let Some(err) = resp.extraction_error {
            chunk_errors += 1;
            tracing::warn!(%document_id, chunk = %chunk_id, error = %err, "chunk fact-extraction call failed");
            if sample_error.is_none() {
                sample_error = Some(err);
            }
        }

        for ef in resp.facts {
            // Defense-in-depth hallucination guard: the intelligence service
            // already verifies the quote server-side, but a fact never gets
            // persisted here unless it's also independently re-verified.
            if !c.text.contains(&ef.quote) {
                tracing::warn!(%document_id, predicate = %ef.predicate, "dropping fact: quote not found verbatim in chunk text");
                continue;
            }

            // predicate resolution — grows the ontology only when genuinely new
            let predicate = match db::find_predicate_by_name(db_pool, &ef.predicate).await? {
                Some(p) => p,
                None => db::insert_predicate(db_pool, &ef.predicate, "numeric", None).await?,
            };

            // entity resolution — never silently merges below a confidence bar
            let candidates = db::candidate_entities(db_pool, &ef.subject, &ef.subject_type, 8).await?;
            let entity_id = if candidates.is_empty() {
                db::insert_entity(db_pool, &ef.subject, &ef.subject_type, &normalized_key(&ef.subject)).await?.id
            } else {
                let resolve_req = ResolveEntityRequest {
                    name: ef.subject.clone(),
                    candidates: candidates.iter().map(|e| EntityCandidate {
                        id: e.id.to_string(), canonical_name: e.canonical_name.clone(), entity_type: e.entity_type.clone(),
                    }).collect(),
                };
                let resolution = client.resolve_entity(&resolve_req).await?;
                match resolution.match_entity_id {
                    Some(id_str) if resolution.confidence >= 0.75 => {
                        let id = Uuid::parse_str(&id_str)?;
                        if resolution.confidence < 0.95 {
                            db::insert_entity_alias(db_pool, id, &ef.subject, resolution.confidence, Some(chunk_id)).await?;
                        }
                        id
                    }
                    _ => db::insert_entity(db_pool, &ef.subject, &ef.subject_type, &normalized_key(&ef.subject)).await?.id,
                }
            };

            let fact = db::insert_fact(
                db_pool, document_id, Some(entity_id), Some(predicate.id), &ef.value_raw, ef.value_normalized.clone(),
                ef.time_type.as_deref(), ef.time_value.as_deref(), ef.scope.as_deref(),
                ef.qualifiers.clone().unwrap_or_else(|| json!({})), ef.confidence,
                json!({"chunk_id": chunk_id, "char_start": ef.char_start, "char_end": ef.char_end}),
                embeddings.embeddings.get(i).cloned(),
            ).await?;

            db::insert_evidence(
                db_pool, fact.id, document_id, c.page_start, Some(chunk_id), &ef.quote,
                Some(ef.char_start), Some(ef.char_end), None, None,
            ).await?;

            new_fact_ids.push(fact.id);
        }
    }
    let total_chunks = built.chunks.len() as i32;
    let metrics = json!({
        "facts": new_fact_ids.len(),
        "dropped_ungrounded": dropped_total,
        "chunk_errors": chunk_errors,
        "chunks_total": total_chunks,
        "sample_error": sample_error,
    });
    // Only a handful of transient failures among many chunks still counts as
    // a usable (if partial) result; every chunk failing means the run never
    // actually worked and must not be reported as a clean "done".
    if chunk_errors > 0 && chunk_errors == total_chunks {
        db::finish_job(db_pool, job.id, "failed", sample_error.as_deref(), metrics).await?;
    } else {
        db::finish_job(db_pool, job.id, "done", None, metrics).await?;
    }

    // ---- stage: pair_candidates + reason_relationships ----
    let job = db::create_job(db_pool, document_id, "reason_relationships").await?;
    let relationships_created = reason_relationships_for_facts(db_pool, client, &new_fact_ids).await?;
    db::finish_job(db_pool, job.id, "done", None, json!({"relationships_created": relationships_created})).await?;

    db::set_document_status(db_pool, document_id, "ready", None).await?;
    tracing::info!(%document_id, facts = new_fact_ids.len(), relationships = relationships_created, "ingestion complete");

    // Best-effort graph projection — the product must degrade gracefully
    // without it, so failures here never fail the whole pipeline.
    if let Err(err) = crate::graph::sync_document(state, document_id).await {
        tracing::warn!(%document_id, error = %err, "graph sync skipped/failed (Neo4j unavailable or misconfigured)");
    }

    Ok(())
}

/// Runs candidate-pairing + relationship reasoning for a given set of facts
/// against the rest of the corpus. Shared by the ingestion pipeline (called
/// with just the newly-extracted facts) and the manual `/relationships/recompute`
/// endpoint (called with every active fact — useful when earlier reasoning
/// calls failed, e.g. a rate-limited Groq account, and facts already exist
/// but were never compared).
pub async fn reason_relationships_for_facts(db_pool: &sqlx::PgPool, client: &IntelligenceClient, fact_ids: &[Uuid]) -> anyhow::Result<i32> {
    let mut relationships_created = 0i32;
    for &fact_id in fact_ids {
        let Some(fact_a) = db::get_fact(db_pool, fact_id).await? else { continue };
        let candidates = db::candidate_related_facts(db_pool, fact_id, fact_a.predicate_id, fact_a.document_id, 5).await?;
        for fact_b in candidates {
            if db::relationship_exists(db_pool, fact_a.id, fact_b.id).await? {
                continue;
            }
            let ev_a = db::evidence_for_fact(db_pool, fact_a.id).await?;
            let ev_b = db::evidence_for_fact(db_pool, fact_b.id).await?;
            let (Some(quote_a), Some(quote_b)) = (ev_a.first(), ev_b.first()) else { continue };

            let doc_a = db::get_document(db_pool, fact_a.document_id).await?;
            let doc_b = db::get_document(db_pool, fact_b.document_id).await?;

            let req = ReasonRelationshipRequest {
                fact_a: to_reasoning_fact(
                    db_pool, &fact_a, quote_a, doc_a.as_ref().map(|d| d.filename.clone()).unwrap_or_default(),
                ).await?,
                fact_b: to_reasoning_fact(
                    db_pool, &fact_b, quote_b, doc_b.as_ref().map(|d| d.filename.clone()).unwrap_or_default(),
                ).await?,
            };
            let result = client.reason_relationship(&req).await?;
            if result.relationship_type != "UNRELATED"
                && db::insert_relationship(db_pool, fact_a.id, fact_b.id, &result.relationship_type, &result.explanation, result.confidence).await?.is_some()
            {
                relationships_created += 1;
            }
        }
    }
    Ok(relationships_created)
}

async fn to_reasoning_fact(
    db_pool: &sqlx::PgPool, fact: &crate::models::Fact, evidence: &crate::models::Evidence, document_filename: String,
) -> anyhow::Result<FactForReasoning> {
    let subject = db::entity_name(db_pool, fact.subject_entity_id).await?.unwrap_or_else(|| "unknown".into());
    let predicate = db::predicate_name(db_pool, fact.predicate_id).await?.unwrap_or_else(|| "unknown".into());
    Ok(FactForReasoning {
        id: fact.id.to_string(),
        subject,
        predicate,
        value_raw: fact.value_raw.clone(),
        value_normalized: fact.value_normalized.clone(),
        time_type: fact.time_type.clone(),
        time_value: fact.time_value.clone(),
        scope: fact.scope.clone(),
        document_filename,
        evidence_quote: evidence.quote.clone(),
    })
}

pub fn resolve_path(document_id: Uuid, upload_dir: &str, extension: &str) -> String {
    Path::new(upload_dir).join(format!("{document_id}.{extension}")).to_string_lossy().into_owned()
}
