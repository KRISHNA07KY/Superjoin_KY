//! Incremental Neo4j projection. Postgres remains authoritative — this module
//! only mirrors the neighborhood touched by the most recent ingestion run
//! into a graph shaped for traversal (§13 of the product spec). Every call is
//! best-effort: the pipeline treats a failure here as a warning, not a hard
//! failure, so the product keeps working with the graph layer disabled.

use crate::db;
use crate::state::AppState;
use neo4rs::{query, Graph};
use uuid::Uuid;

const ALLOWED_RELATIONSHIP_TYPES: &[&str] = &[
    "CORROBORATES", "CONTRADICTS", "POTENTIAL_CONTRADICTION", "RECONCILES",
    "TEMPORAL_UPDATE", "UNIT_DIFFERENCE", "SCOPE_DIFFERENCE", "UNCERTAIN",
];

pub async fn connect() -> anyhow::Result<Graph> {
    let uri = std::env::var("NEO4J_URI").unwrap_or_else(|_| "bolt://localhost:7687".into());
    let user = std::env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".into());
    let pass = std::env::var("NEO4J_PASSWORD").unwrap_or_else(|_| "groundwork123".into());
    Ok(Graph::new(uri, user, pass).await?)
}

pub async fn sync_document(state: &AppState, document_id: Uuid) -> anyhow::Result<()> {
    let graph = connect().await?;

    let Some(document) = db::get_document(&state.db, document_id).await? else { return Ok(()) };
    graph.run(query(
        "MERGE (d:Document {id: $id}) SET d.filename = $filename, d.status = $status"
    ).param("id", document.id.to_string()).param("filename", document.filename).param("status", document.status)).await?;

    let facts = db::facts_by_document(&state.db, document_id).await?;
    for fact in &facts {
        graph.run(query(
            "MERGE (f:Fact {id: $id}) SET f.value_raw = $value_raw, f.confidence = $confidence,
                f.time_value = $time_value, f.scope = $scope"
        )
            .param("id", fact.id.to_string())
            .param("value_raw", fact.value_raw.clone())
            .param("confidence", fact.confidence as f64)
            .param("time_value", fact.time_value.clone().unwrap_or_default())
            .param("scope", fact.scope.clone().unwrap_or_default())
        ).await?;

        graph.run(query(
            "MATCH (f:Fact {id: $fid}), (d:Document {id: $did}) MERGE (f)-[:FROM_DOCUMENT]->(d)"
        ).param("fid", fact.id.to_string()).param("did", document.id.to_string())).await?;

        if let Some(entity_name) = db::entity_name(&state.db, fact.subject_entity_id).await? {
            if let Some(entity_id) = fact.subject_entity_id {
                graph.run(query("MERGE (e:Entity {id: $id}) SET e.name = $name")
                    .param("id", entity_id.to_string()).param("name", entity_name)).await?;
                graph.run(query(
                    "MATCH (f:Fact {id: $fid}), (e:Entity {id: $eid}) MERGE (f)-[:ABOUT]->(e)"
                ).param("fid", fact.id.to_string()).param("eid", entity_id.to_string())).await?;
            }
        }

        for evidence in db::evidence_for_fact(&state.db, fact.id).await? {
            graph.run(query(
                "MERGE (ev:Evidence {id: $id}) SET ev.quote = $quote, ev.page_number = $page"
            )
                .param("id", evidence.id.to_string())
                .param("quote", evidence.quote.clone())
                .param("page", evidence.page_number as i64)
            ).await?;
            graph.run(query(
                "MATCH (f:Fact {id: $fid}), (ev:Evidence {id: $eid}) MERGE (f)-[:SUPPORTED_BY]->(ev)"
            ).param("fid", fact.id.to_string()).param("eid", evidence.id.to_string())).await?;
            graph.run(query(
                "MATCH (ev:Evidence {id: $eid}), (d:Document {id: $did}) MERGE (ev)-[:FROM]->(d)"
            ).param("eid", evidence.id.to_string()).param("did", document.id.to_string())).await?;
        }

        for rel in db::relationships_for_fact(&state.db, fact.id).await? {
            let rel_type = rel.relationship_type.to_uppercase();
            if !ALLOWED_RELATIONSHIP_TYPES.contains(&rel_type.as_str()) {
                continue; // never interpolate an unvalidated string into Cypher
            }
            let cypher = format!(
                "MATCH (a:Fact {{id: $aid}}), (b:Fact {{id: $bid}}) MERGE (a)-[r:{rel_type}]->(b) SET r.explanation = $explanation, r.confidence = $confidence"
            );
            graph.run(query(&cypher)
                .param("aid", rel.fact_a_id.to_string())
                .param("bid", rel.fact_b_id.to_string())
                .param("explanation", rel.explanation.clone())
                .param("confidence", rel.confidence as f64)
            ).await?;
        }
    }

    Ok(())
}
