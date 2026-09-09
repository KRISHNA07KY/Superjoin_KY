use crate::error::AppError;
use crate::state::AppState;
use crate::{db, models::FactView};
use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_facts))
        .route("/:id", get(get_fact))
        .route("/:id/evidence", get(get_fact_evidence))
        .route("/:id/relationships", get(get_fact_relationships))
}

pub(crate) async fn to_view(state: &AppState, fact: crate::models::Fact) -> Result<FactView, AppError> {
    let document = db::get_document(&state.db, fact.document_id).await?;
    let subject = db::entity_name(&state.db, fact.subject_entity_id).await?;
    let predicate = db::predicate_name(&state.db, fact.predicate_id).await?;
    let evidence = db::evidence_for_fact(&state.db, fact.id).await?;
    Ok(FactView {
        id: fact.id,
        document_id: fact.document_id,
        document_filename: document.map(|d| d.filename).unwrap_or_default(),
        subject,
        predicate,
        value_raw: fact.value_raw,
        value_normalized: fact.value_normalized,
        time_type: fact.time_type,
        time_value: fact.time_value,
        scope: fact.scope,
        confidence: fact.confidence,
        evidence,
    })
}

async fn list_facts(State(state): State<AppState>) -> Result<Json<Vec<FactView>>, AppError> {
    let facts = db::list_facts(&state.db, 200).await?;
    let mut views = Vec::with_capacity(facts.len());
    for f in facts {
        views.push(to_view(&state, f).await?);
    }
    Ok(Json(views))
}

async fn get_fact(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<FactView>, AppError> {
    let fact = db::get_fact(&state.db, id).await?.ok_or(AppError::NotFound)?;
    Ok(Json(to_view(&state, fact).await?))
}

async fn get_fact_evidence(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Vec<crate::models::Evidence>>, AppError> {
    Ok(Json(db::evidence_for_fact(&state.db, id).await?))
}

async fn get_fact_relationships(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Vec<crate::models::Relationship>>, AppError> {
    Ok(Json(db::relationships_for_fact(&state.db, id).await?))
}
