use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Document {
    pub id: Uuid,
    pub filename: String,
    pub sha256: String,
    pub mime_type: String,
    pub page_count: Option<i32>,
    pub status: String,
    pub uploaded_at: DateTime<Utc>,
    pub processed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Page {
    pub id: Uuid,
    pub document_id: Uuid,
    pub page_number: i32,
    pub extraction_method: String,
    pub text: String,
    pub confidence: Option<f32>,
    pub layout: Option<Json>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Chunk {
    pub id: Uuid,
    pub document_id: Uuid,
    pub page_start: i32,
    pub page_end: i32,
    pub text: String,
    pub char_start: i32,
    pub char_end: i32,
    pub token_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Predicate {
    pub id: Uuid,
    pub canonical_name: String,
    pub aliases: Vec<String>,
    pub value_type: String,
    pub unit_class: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Entity {
    pub id: Uuid,
    pub canonical_name: String,
    pub entity_type: String,
    pub normalized_key: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Fact {
    pub id: Uuid,
    pub document_id: Uuid,
    pub subject_entity_id: Option<Uuid>,
    pub predicate_id: Option<Uuid>,
    pub value_raw: String,
    pub value_normalized: Option<Json>,
    pub time_type: Option<String>,
    pub time_value: Option<String>,
    pub scope: Option<String>,
    pub qualifiers: Json,
    pub confidence: f32,
    pub extraction_metadata: Json,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Evidence {
    pub id: Uuid,
    pub fact_id: Uuid,
    pub document_id: Uuid,
    pub page_number: i32,
    pub chunk_id: Option<Uuid>,
    pub quote: String,
    pub char_start: Option<i32>,
    pub char_end: Option<i32>,
    pub bbox: Option<Json>,
    pub ocr_confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Relationship {
    pub id: Uuid,
    pub fact_a_id: Uuid,
    pub fact_b_id: Uuid,
    pub relationship_type: String,
    pub explanation: String,
    pub confidence: f32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ProcessingJob {
    pub id: Uuid,
    pub document_id: Uuid,
    pub stage: String,
    pub status: String,
    pub error: Option<String>,
    pub metrics: Json,
}

/// A fact enriched with its evidence and resolved subject/predicate names —
/// the shape returned to the frontend, never the raw row.
#[derive(Debug, Clone, Serialize)]
pub struct FactView {
    pub id: Uuid,
    pub document_id: Uuid,
    pub document_filename: String,
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub value_raw: String,
    pub value_normalized: Option<Json>,
    pub time_type: Option<String>,
    pub time_value: Option<String>,
    pub scope: Option<String>,
    pub confidence: f32,
    pub evidence: Vec<Evidence>,
}
