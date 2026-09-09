use crate::error::AppError;
use crate::state::AppState;
use crate::{db, models::Entity};
use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_entities))
        .route("/:id", get(get_entity))
}

async fn list_entities(State(state): State<AppState>) -> Result<Json<Vec<Entity>>, AppError> {
    Ok(Json(db::list_entities(&state.db, 200).await?))
}

async fn get_entity(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Entity>, AppError> {
    db::get_entity(&state.db, id).await?.map(Json).ok_or(AppError::NotFound)
}
