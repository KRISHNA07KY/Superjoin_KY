//! All Postgres access lives here. Deliberately uses runtime-checked
//! `sqlx::query`/`query_as` (not the `query!` compile-time macros) so `cargo
//! build`/`check` never needs a live database connection.

use crate::models::*;
use pgvector::Vector;
use serde_json::Value as Json;
use sqlx::PgPool;
use uuid::Uuid;

// ---------------- documents ----------------

pub async fn find_document_by_sha256(db: &PgPool, sha256: &str) -> sqlx::Result<Option<Document>> {
    sqlx::query_as::<_, Document>("SELECT * FROM documents WHERE sha256 = $1")
        .bind(sha256)
        .fetch_optional(db)
        .await
}

pub async fn insert_document(db: &PgPool, filename: &str, sha256: &str, mime_type: &str) -> sqlx::Result<Document> {
    sqlx::query_as::<_, Document>(
        "INSERT INTO documents (filename, sha256, mime_type) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(filename)
    .bind(sha256)
    .bind(mime_type)
    .fetch_one(db)
    .await
}

pub async fn list_documents(db: &PgPool) -> sqlx::Result<Vec<Document>> {
    sqlx::query_as::<_, Document>("SELECT * FROM documents ORDER BY uploaded_at DESC")
        .fetch_all(db)
        .await
}

pub async fn get_document(db: &PgPool, id: Uuid) -> sqlx::Result<Option<Document>> {
    sqlx::query_as::<_, Document>("SELECT * FROM documents WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn set_document_status(db: &PgPool, id: Uuid, status: &str, page_count: Option<i32>) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE documents SET status = $2, page_count = COALESCE($3, page_count),
         processed_at = CASE WHEN $2 = 'ready' THEN now() ELSE processed_at END WHERE id = $1",
    )
    .bind(id)
    .bind(status)
    .bind(page_count)
    .execute(db)
    .await?;
    Ok(())
}

// ---------------- pages ----------------

pub async fn insert_page(
    db: &PgPool,
    document_id: Uuid,
    page_number: i32,
    extraction_method: &str,
    text: &str,
    confidence: Option<f32>,
    layout: Option<Json>,
) -> sqlx::Result<Page> {
    sqlx::query_as::<_, Page>(
        "INSERT INTO pages (document_id, page_number, extraction_method, text, confidence, layout)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    )
    .bind(document_id)
    .bind(page_number)
    .bind(extraction_method)
    .bind(text)
    .bind(confidence)
    .bind(layout)
    .fetch_one(db)
    .await
}

pub async fn get_page(db: &PgPool, document_id: Uuid, page_number: i32) -> sqlx::Result<Option<Page>> {
    sqlx::query_as::<_, Page>("SELECT * FROM pages WHERE document_id = $1 AND page_number = $2")
        .bind(document_id)
        .bind(page_number)
        .fetch_optional(db)
        .await
}

pub async fn list_pages(db: &PgPool, document_id: Uuid) -> sqlx::Result<Vec<Page>> {
    sqlx::query_as::<_, Page>("SELECT * FROM pages WHERE document_id = $1 ORDER BY page_number")
        .bind(document_id)
        .fetch_all(db)
        .await
}

// ---------------- chunks ----------------

pub async fn insert_chunk(
    db: &PgPool,
    document_id: Uuid,
    page_start: i32,
    page_end: i32,
    text: &str,
    char_start: i32,
    char_end: i32,
    token_count: Option<i32>,
    embedding: Option<Vec<f32>>,
) -> sqlx::Result<Chunk> {
    sqlx::query_as::<_, Chunk>(
        "INSERT INTO chunks (document_id, page_start, page_end, text, char_start, char_end, token_count, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, document_id, page_start, page_end, text, char_start, char_end, token_count",
    )
    .bind(document_id)
    .bind(page_start)
    .bind(page_end)
    .bind(text)
    .bind(char_start)
    .bind(char_end)
    .bind(token_count)
    .bind(embedding.map(Vector::from))
    .fetch_one(db)
    .await
}

pub async fn search_chunks_by_embedding(db: &PgPool, embedding: Vec<f32>, limit: i64) -> sqlx::Result<Vec<Chunk>> {
    sqlx::query_as::<_, Chunk>(
        "SELECT id, document_id, page_start, page_end, text, char_start, char_end, token_count
         FROM chunks ORDER BY embedding <=> $1 LIMIT $2",
    )
    .bind(Vector::from(embedding))
    .bind(limit)
    .fetch_all(db)
    .await
}

// ---------------- predicates ----------------

pub async fn list_predicates(db: &PgPool) -> sqlx::Result<Vec<Predicate>> {
    sqlx::query_as::<_, Predicate>("SELECT * FROM predicates ORDER BY canonical_name")
        .fetch_all(db)
        .await
}

pub async fn find_predicate_by_name(db: &PgPool, canonical_name: &str) -> sqlx::Result<Option<Predicate>> {
    sqlx::query_as::<_, Predicate>(
        "SELECT * FROM predicates WHERE canonical_name = $1 OR $1 = ANY(aliases)",
    )
    .bind(canonical_name)
    .fetch_optional(db)
    .await
}

pub async fn insert_predicate(db: &PgPool, canonical_name: &str, value_type: &str, unit_class: Option<&str>) -> sqlx::Result<Predicate> {
    sqlx::query_as::<_, Predicate>(
        "INSERT INTO predicates (canonical_name, value_type, unit_class) VALUES ($1, $2, $3)
         ON CONFLICT (canonical_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name
         RETURNING *",
    )
    .bind(canonical_name)
    .bind(value_type)
    .bind(unit_class)
    .fetch_one(db)
    .await
}

// ---------------- entities ----------------

pub async fn list_entities(db: &PgPool, limit: i64) -> sqlx::Result<Vec<Entity>> {
    sqlx::query_as::<_, Entity>("SELECT * FROM entities ORDER BY canonical_name LIMIT $1")
        .bind(limit)
        .fetch_all(db)
        .await
}

pub async fn entity_name(db: &PgPool, id: Option<Uuid>) -> sqlx::Result<Option<String>> {
    let Some(id) = id else { return Ok(None) };
    let row: Option<(String,)> = sqlx::query_as("SELECT canonical_name FROM entities WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await?;
    Ok(row.map(|r| r.0))
}

pub async fn predicate_name(db: &PgPool, id: Option<Uuid>) -> sqlx::Result<Option<String>> {
    let Some(id) = id else { return Ok(None) };
    let row: Option<(String,)> = sqlx::query_as("SELECT canonical_name FROM predicates WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await?;
    Ok(row.map(|r| r.0))
}

pub async fn get_entity(db: &PgPool, id: Uuid) -> sqlx::Result<Option<Entity>> {
    sqlx::query_as::<_, Entity>("SELECT * FROM entities WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await
}

/// Candidate entities for resolution: trigram-similar canonical names, capped.
/// This is the "don't compare against everything" guard for entity resolution.
pub async fn candidate_entities(db: &PgPool, name: &str, entity_type: &str, limit: i64) -> sqlx::Result<Vec<Entity>> {
    sqlx::query_as::<_, Entity>(
        "SELECT * FROM entities WHERE entity_type = $2
         ORDER BY similarity(canonical_name, $1) DESC LIMIT $3",
    )
    .bind(name)
    .bind(entity_type)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn insert_entity(db: &PgPool, canonical_name: &str, entity_type: &str, normalized_key: &str) -> sqlx::Result<Entity> {
    sqlx::query_as::<_, Entity>(
        "INSERT INTO entities (canonical_name, entity_type, normalized_key) VALUES ($1, $2, $3)
         ON CONFLICT (normalized_key, entity_type) DO UPDATE SET canonical_name = entities.canonical_name
         RETURNING *",
    )
    .bind(canonical_name)
    .bind(entity_type)
    .bind(normalized_key)
    .fetch_one(db)
    .await
}

pub async fn insert_entity_alias(db: &PgPool, entity_id: Uuid, alias_text: &str, confidence: f32, source_chunk_id: Option<Uuid>) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO entity_aliases (entity_id, alias_text, confidence, source_chunk_id) VALUES ($1, $2, $3, $4)")
        .bind(entity_id)
        .bind(alias_text)
        .bind(confidence)
        .bind(source_chunk_id)
        .execute(db)
        .await?;
    Ok(())
}

// ---------------- facts ----------------

#[allow(clippy::too_many_arguments)]
pub async fn insert_fact(
    db: &PgPool,
    document_id: Uuid,
    subject_entity_id: Option<Uuid>,
    predicate_id: Option<Uuid>,
    value_raw: &str,
    value_normalized: Option<Json>,
    time_type: Option<&str>,
    time_value: Option<&str>,
    scope: Option<&str>,
    qualifiers: Json,
    confidence: f32,
    extraction_metadata: Json,
    embedding: Option<Vec<f32>>,
) -> sqlx::Result<Fact> {
    sqlx::query_as::<_, Fact>(
        "INSERT INTO facts (document_id, subject_entity_id, predicate_id, value_raw, value_normalized,
            time_type, time_value, scope, qualifiers, confidence, extraction_metadata, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, document_id, subject_entity_id, predicate_id, value_raw, value_normalized,
            time_type, time_value, scope, qualifiers, confidence, extraction_metadata, status, created_at",
    )
    .bind(document_id)
    .bind(subject_entity_id)
    .bind(predicate_id)
    .bind(value_raw)
    .bind(value_normalized)
    .bind(time_type)
    .bind(time_value)
    .bind(scope)
    .bind(qualifiers)
    .bind(confidence)
    .bind(extraction_metadata)
    .bind(embedding.map(Vector::from))
    .fetch_one(db)
    .await
}

pub async fn get_fact(db: &PgPool, id: Uuid) -> sqlx::Result<Option<Fact>> {
    sqlx::query_as::<_, Fact>("SELECT * FROM facts WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn list_active_fact_ids(db: &PgPool) -> sqlx::Result<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM facts WHERE status = 'active'")
        .fetch_all(db)
        .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

pub async fn list_facts(db: &PgPool, limit: i64) -> sqlx::Result<Vec<Fact>> {
    sqlx::query_as::<_, Fact>("SELECT * FROM facts WHERE status = 'active' ORDER BY created_at DESC LIMIT $1")
        .bind(limit)
        .fetch_all(db)
        .await
}

/// Candidate facts for cross-document reasoning: same predicate, different
/// document, capped top-K by embedding distance. Never all-pairs.
pub async fn candidate_related_facts(db: &PgPool, fact_id: Uuid, predicate_id: Option<Uuid>, document_id: Uuid, limit: i64) -> sqlx::Result<Vec<Fact>> {
    sqlx::query_as::<_, Fact>(
        "SELECT f2.* FROM facts f1
         JOIN facts f2 ON f2.predicate_id IS NOT DISTINCT FROM f1.predicate_id
         WHERE f1.id = $1 AND f2.id <> $1 AND f2.document_id <> $3
           AND f1.predicate_id IS NOT NULL AND $2 IS NOT NULL
           AND f2.status = 'active'
         ORDER BY (f1.embedding <=> f2.embedding) LIMIT $4",
    )
    .bind(fact_id)
    .bind(predicate_id)
    .bind(document_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn facts_by_document(db: &PgPool, document_id: Uuid) -> sqlx::Result<Vec<Fact>> {
    sqlx::query_as::<_, Fact>("SELECT * FROM facts WHERE document_id = $1 ORDER BY created_at")
        .bind(document_id)
        .fetch_all(db)
        .await
}

pub async fn search_facts_by_embedding(db: &PgPool, embedding: Vec<f32>, limit: i64) -> sqlx::Result<Vec<Fact>> {
    sqlx::query_as::<_, Fact>(
        "SELECT * FROM facts WHERE status = 'active' ORDER BY embedding <=> $1 LIMIT $2",
    )
    .bind(Vector::from(embedding))
    .bind(limit)
    .fetch_all(db)
    .await
}

// ---------------- evidence ----------------

#[allow(clippy::too_many_arguments)]
pub async fn insert_evidence(
    db: &PgPool,
    fact_id: Uuid,
    document_id: Uuid,
    page_number: i32,
    chunk_id: Option<Uuid>,
    quote: &str,
    char_start: Option<i32>,
    char_end: Option<i32>,
    bbox: Option<Json>,
    ocr_confidence: Option<f32>,
) -> sqlx::Result<Evidence> {
    sqlx::query_as::<_, Evidence>(
        "INSERT INTO evidence (fact_id, document_id, page_number, chunk_id, quote, char_start, char_end, bbox, ocr_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    )
    .bind(fact_id)
    .bind(document_id)
    .bind(page_number)
    .bind(chunk_id)
    .bind(quote)
    .bind(char_start)
    .bind(char_end)
    .bind(bbox)
    .bind(ocr_confidence)
    .fetch_one(db)
    .await
}

pub async fn evidence_for_fact(db: &PgPool, fact_id: Uuid) -> sqlx::Result<Vec<Evidence>> {
    sqlx::query_as::<_, Evidence>("SELECT * FROM evidence WHERE fact_id = $1 ORDER BY page_number")
        .bind(fact_id)
        .fetch_all(db)
        .await
}

// ---------------- relationships ----------------

pub async fn insert_relationship(
    db: &PgPool,
    fact_a_id: Uuid,
    fact_b_id: Uuid,
    relationship_type: &str,
    explanation: &str,
    confidence: f32,
) -> sqlx::Result<Option<Relationship>> {
    sqlx::query_as::<_, Relationship>(
        "INSERT INTO relationships (fact_a_id, fact_b_id, relationship_type, explanation, confidence)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING RETURNING *",
    )
    .bind(fact_a_id)
    .bind(fact_b_id)
    .bind(relationship_type)
    .bind(explanation)
    .bind(confidence)
    .fetch_optional(db)
    .await
}

pub async fn list_relationships(db: &PgPool, limit: i64) -> sqlx::Result<Vec<Relationship>> {
    sqlx::query_as::<_, Relationship>("SELECT * FROM relationships ORDER BY created_at DESC LIMIT $1")
        .bind(limit)
        .fetch_all(db)
        .await
}

pub async fn relationships_for_fact(db: &PgPool, fact_id: Uuid) -> sqlx::Result<Vec<Relationship>> {
    sqlx::query_as::<_, Relationship>(
        "SELECT * FROM relationships WHERE fact_a_id = $1 OR fact_b_id = $1 ORDER BY created_at DESC",
    )
    .bind(fact_id)
    .fetch_all(db)
    .await
}

pub async fn relationship_exists(db: &PgPool, fact_a_id: Uuid, fact_b_id: Uuid) -> sqlx::Result<bool> {
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT true FROM relationships WHERE (fact_a_id = $1 AND fact_b_id = $2) OR (fact_a_id = $2 AND fact_b_id = $1)",
    )
    .bind(fact_a_id)
    .bind(fact_b_id)
    .fetch_optional(db)
    .await?;
    Ok(row.is_some())
}

// ---------------- processing jobs ----------------

pub async fn create_job(db: &PgPool, document_id: Uuid, stage: &str) -> sqlx::Result<ProcessingJob> {
    sqlx::query_as::<_, ProcessingJob>(
        "INSERT INTO processing_jobs (document_id, stage, status, started_at) VALUES ($1, $2, 'running', now())
         RETURNING id, document_id, stage, status, error, metrics",
    )
    .bind(document_id)
    .bind(stage)
    .fetch_one(db)
    .await
}

pub async fn finish_job(db: &PgPool, job_id: Uuid, status: &str, error: Option<&str>, metrics: Json) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE processing_jobs SET status = $2, error = $3, metrics = $4, finished_at = now() WHERE id = $1",
    )
    .bind(job_id)
    .bind(status)
    .bind(error)
    .bind(metrics)
    .execute(db)
    .await?;
    Ok(())
}

/// Marks any job stuck in "running" for this document as failed — used when
/// the pipeline errors out mid-stage so /documents/:id/jobs never shows a
/// stale "running" row forever (real observability, not invented progress).
pub async fn fail_running_jobs(db: &PgPool, document_id: Uuid, error: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE processing_jobs SET status = 'failed', error = $2, finished_at = now()
         WHERE document_id = $1 AND status = 'running'",
    )
    .bind(document_id)
    .bind(error)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn jobs_for_document(db: &PgPool, document_id: Uuid) -> sqlx::Result<Vec<ProcessingJob>> {
    sqlx::query_as::<_, ProcessingJob>(
        "SELECT id, document_id, stage, status, error, metrics FROM processing_jobs WHERE document_id = $1 ORDER BY created_at",
    )
    .bind(document_id)
    .fetch_all(db)
    .await
}
