use crate::error::AppError;
use crate::pipeline;
use crate::state::AppState;
use crate::{db, models::Relationship};
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_relationships))
        .route("/recompute", post(recompute_relationships))
}

/// "Claims needing attention": every non-corroborating relationship, newest
/// first — the backing data for a Conflict Explorer view.
async fn list_relationships(State(state): State<AppState>) -> Result<Json<Vec<Relationship>>, AppError> {
    Ok(Json(db::list_relationships(&state.db, 200).await?))
}

/// Re-runs candidate-pairing + reasoning across every active fact. Facts
/// already exist independently of this stage succeeding, so if reasoning
/// calls failed earlier (e.g. the AI backend was rate-limited) this lets
/// existing facts get compared without needing to re-upload documents.
async fn recompute_relationships(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let fact_ids = db::list_active_fact_ids(&state.db).await?;
    let created = pipeline::reason_relationships_for_facts(&state.db, &state.intelligence, &fact_ids)
        .await
        .map_err(AppError::from)?;
    Ok(Json(json!({ "facts_considered": fact_ids.len(), "relationships_created": created })))
}
