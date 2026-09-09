use crate::error::AppError;
use crate::pipeline;
use crate::state::AppState;
use crate::{db, models::Document};
use axum::body::Body;
use axum::extract::{Multipart, Path, State};
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_documents).post(upload_document))
        .route("/:id", get(get_document))
        .route("/:id/file", get(get_document_file))
        .route("/:id/jobs", get(get_jobs))
        .route("/:id/pages", get(list_pages))
        .route("/:id/pages/:page", get(get_page))
        .route("/:id/facts", get(get_document_facts))
}

async fn list_documents(State(state): State<AppState>) -> Result<Json<Vec<Document>>, AppError> {
    Ok(Json(db::list_documents(&state.db).await?))
}

async fn get_document(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Document>, AppError> {
    db::get_document(&state.db, id).await?.map(Json).ok_or(AppError::NotFound)
}

/// Serves the original PDF bytes so the frontend viewer can render the exact
/// source page a citation points to. Range requests aren't implemented yet
/// (noted as a limitation for very large PDFs) — the whole file is streamed.
async fn get_document_file(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<impl IntoResponse, AppError> {
    let document = db::get_document(&state.db, id).await?.ok_or(AppError::NotFound)?;
    let path = pipeline::resolve_path(document.id, &state.upload_dir, "pdf");
    let file = tokio::fs::File::open(&path).await.map_err(|_| AppError::NotFound)?;
    let stream = tokio_util::io::ReaderStream::new(file);
    let body = Body::from_stream(stream);
    let headers = [
        (header::CONTENT_TYPE, "application/pdf".to_string()),
        (header::CONTENT_DISPOSITION, format!("inline; filename=\"{}\"", document.filename)),
    ];
    Ok((headers, body))
}

async fn get_jobs(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(db::jobs_for_document(&state.db, id).await?))
}

async fn get_document_facts(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(db::facts_by_document(&state.db, id).await?))
}

async fn list_pages(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(db::list_pages(&state.db, id).await?))
}

async fn get_page(State(state): State<AppState>, Path((id, page)): Path<(Uuid, i32)>) -> Result<impl IntoResponse, AppError> {
    db::get_page(&state.db, id, page).await?.map(Json).ok_or(AppError::NotFound)
}

/// Upload → fingerprint (sha256 dedupe) → persist file → kick off the
/// ingestion pipeline in the background → return immediately with the
/// document row so the UI can poll /documents/{id}/jobs for progress.
async fn upload_document(State(state): State<AppState>, mut multipart: Multipart) -> Result<impl IntoResponse, AppError> {
    let mut filename = "upload.pdf".to_string();
    let mut bytes: Option<axum::body::Bytes> = None;

    while let Some(field) = multipart.next_field().await.map_err(|_| AppError::BadRequest("invalid multipart body".into()))? {
        if field.name() == Some("file") {
            filename = field.file_name().unwrap_or("upload.pdf").to_string();
            bytes = Some(field.bytes().await.map_err(|_| AppError::BadRequest("failed to read file".into()))?);
        }
    }
    let bytes = bytes.ok_or(AppError::BadRequest("missing 'file' field".into()))?;
    if bytes.is_empty() {
        return Err(AppError::BadRequest("empty file".into()));
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = hex::encode(hasher.finalize());

    if let Some(existing) = db::find_document_by_sha256(&state.db, &sha256).await? {
        return Ok((StatusCode::OK, Json(json!({ "document": existing, "deduplicated": true }))));
    }

    let document = db::insert_document(&state.db, &filename, &sha256, "application/pdf").await?;
    let path = pipeline::resolve_path(document.id, &state.upload_dir, "pdf");
    tokio::fs::write(&path, &bytes).await.map_err(|e| AppError::Internal(e.into()))?;

    tokio::spawn(pipeline::run_ingestion(state.clone(), document.id, path));

    Ok((StatusCode::CREATED, Json(json!({ "document": document, "deduplicated": false }))))
}
