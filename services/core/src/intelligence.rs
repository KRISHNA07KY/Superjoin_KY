//! Typed client for the Python "intelligence" service. This file *is* the
//! contract between the two services — services/intelligence must implement
//! exactly these request/response shapes.

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

#[derive(Clone)]
pub struct IntelligenceClient {
    http: reqwest::Client,
    base_url: String,
}

impl IntelligenceClient {
    pub fn new(base_url: String) -> Self {
        Self { http: reqwest::Client::new(), base_url }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url.trim_end_matches('/'), path)
    }

    pub async fn extract_pages(&self, req: &ExtractPagesRequest) -> anyhow::Result<ExtractPagesResponse> {
        let resp = self.http.post(self.url("/pages/extract")).json(req).send().await?;
        Ok(resp.error_for_status()?.json().await?)
    }

    pub async fn build_chunks(&self, req: &BuildChunksRequest) -> anyhow::Result<BuildChunksResponse> {
        let resp = self.http.post(self.url("/chunks/build")).json(req).send().await?;
        Ok(resp.error_for_status()?.json().await?)
    }

    pub async fn embed(&self, texts: Vec<String>) -> anyhow::Result<EmbedResponse> {
        let resp = self.http.post(self.url("/embed")).json(&EmbedRequest { texts }).send().await?;
        Ok(resp.error_for_status()?.json().await?)
    }

    pub async fn extract_facts(&self, req: &ExtractFactsRequest) -> anyhow::Result<ExtractFactsResponse> {
        let resp = self.http.post(self.url("/facts/extract")).json(req).send().await?;
        Ok(resp.error_for_status()?.json().await?)
    }

    pub async fn resolve_entity(&self, req: &ResolveEntityRequest) -> anyhow::Result<ResolveEntityResponse> {
        let resp = self.http.post(self.url("/entities/resolve")).json(req).send().await?;
        Ok(resp.error_for_status()?.json().await?)
    }

    pub async fn reason_relationship(&self, req: &ReasonRelationshipRequest) -> anyhow::Result<ReasonRelationshipResponse> {
        let resp = self.http.post(self.url("/relationships/reason")).json(req).send().await?;
        Ok(resp.error_for_status()?.json().await?)
    }

    pub async fn answer_plan(&self, req: &AnswerPlanRequest) -> anyhow::Result<AnswerPlanResponse> {
        let resp = self.http.post(self.url("/answer/plan")).json(req).send().await?;
        Ok(resp.error_for_status()?.json().await?)
    }
}

// ---- /pages/extract ----
#[derive(Serialize)]
pub struct ExtractPagesRequest {
    pub document_id: String,
    pub path: String,
}
#[derive(Deserialize, Debug)]
pub struct ExtractedPage {
    pub page_number: i32,
    pub extraction_method: String, // native|ocr|failed
    pub text: String,
    pub confidence: Option<f32>,
    pub layout: Option<Json>,
}
#[derive(Deserialize, Debug)]
pub struct ExtractPagesResponse {
    pub pages: Vec<ExtractedPage>,
    pub page_count: i32,
}

// ---- /chunks/build ----
#[derive(Serialize)]
pub struct PageInput {
    pub page_number: i32,
    pub text: String,
}
#[derive(Serialize)]
pub struct BuildChunksRequest {
    pub document_id: String,
    pub pages: Vec<PageInput>,
}
#[derive(Deserialize, Debug, Clone)]
pub struct BuiltChunk {
    pub page_start: i32,
    pub page_end: i32,
    pub text: String,
    pub char_start: i32,
    pub char_end: i32,
    pub token_count: Option<i32>,
}
#[derive(Deserialize, Debug)]
pub struct BuildChunksResponse {
    pub chunks: Vec<BuiltChunk>,
}

// ---- /embed ----
#[derive(Serialize)]
pub struct EmbedRequest {
    pub texts: Vec<String>,
}
#[derive(Deserialize, Debug)]
pub struct EmbedResponse {
    pub embeddings: Vec<Vec<f32>>,
    pub dim: i32,
    pub model: String,
}

// ---- /facts/extract ----
#[derive(Serialize)]
#[derive(Clone)]
pub struct KnownPredicate {
    pub canonical_name: String,
    pub aliases: Vec<String>,
}
#[derive(Serialize)]
pub struct ChunkInput {
    pub id: String,
    pub text: String,
    pub page_start: i32,
    pub page_end: i32,
}
#[derive(Serialize)]
pub struct ExtractFactsRequest {
    pub document_id: String,
    pub chunk: ChunkInput,
    pub known_predicates: Vec<KnownPredicate>,
}
#[derive(Deserialize, Debug, Clone)]
pub struct ExtractedFact {
    pub subject: String,
    pub subject_type: String, // org|person|place|other
    pub predicate: String,
    pub predicate_is_new: bool,
    pub value_raw: String,
    pub value_normalized: Option<Json>,
    pub time_type: Option<String>,
    pub time_value: Option<String>,
    pub scope: Option<String>,
    pub qualifiers: Option<Json>,
    pub confidence: f32,
    pub quote: String,
    pub char_start: i32,
    pub char_end: i32,
}
#[derive(Deserialize, Debug)]
pub struct ExtractFactsResponse {
    pub facts: Vec<ExtractedFact>,
    pub dropped_ungrounded: i32,
    /// Set when the Groq call for this chunk failed outright (rate limit,
    /// network, etc.) rather than legitimately finding nothing — surfaced in
    /// job metrics so a real failure is never mistaken for "0 facts, clean."
    pub extraction_error: Option<String>,
}

// ---- /entities/resolve ----
#[derive(Serialize)]
pub struct EntityCandidate {
    pub id: String,
    pub canonical_name: String,
    pub entity_type: String,
}
#[derive(Serialize)]
pub struct ResolveEntityRequest {
    pub name: String,
    pub candidates: Vec<EntityCandidate>,
}
#[derive(Deserialize, Debug)]
pub struct ResolveEntityResponse {
    pub match_entity_id: Option<String>,
    pub confidence: f32,
    pub reasoning: String,
}

// ---- /relationships/reason ----
#[derive(Serialize)]
pub struct FactForReasoning {
    pub id: String,
    pub subject: String,
    pub predicate: String,
    pub value_raw: String,
    pub value_normalized: Option<Json>,
    pub time_type: Option<String>,
    pub time_value: Option<String>,
    pub scope: Option<String>,
    pub document_filename: String,
    pub evidence_quote: String,
}
#[derive(Serialize)]
pub struct ReasonRelationshipRequest {
    pub fact_a: FactForReasoning,
    pub fact_b: FactForReasoning,
}
#[derive(Deserialize, Debug)]
pub struct ReasonRelationshipResponse {
    pub relationship_type: String,
    pub explanation: String,
    pub confidence: f32,
}

// ---- /answer/plan ----
#[derive(Serialize)]
pub struct AnswerPlanRequest {
    pub question: String,
    pub retrieved_facts: Vec<Json>,
    pub retrieved_chunks: Vec<Json>,
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}
#[derive(Deserialize, Debug)]
pub struct AnswerPlanResponse {
    pub plan: Json,
}
