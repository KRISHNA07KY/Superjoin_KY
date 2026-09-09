use axum::extract::DefaultBodyLimit;
use axum::{routing::get, Router};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod db;
mod error;
mod graph;
mod intelligence;
mod models;
mod pipeline;
mod routes;
mod state;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let state = state::AppState::connect().await?;

    let app = Router::new()
        .route("/health", get(routes::health::health))
        .nest("/documents", routes::documents::router())
        .nest("/facts", routes::facts::router())
        .nest("/relationships", routes::relationships::router())
        .nest("/entities", routes::entities::router())
        .nest("/query", routes::query::router())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        // Axum's default is 2MB, which real annual reports/prospectuses
        // blow past — 200MB comfortably covers "large PDFs" (§25 brownie point).
        .layer(DefaultBodyLimit::max(200 * 1024 * 1024))
        .with_state(state);

    let port: u16 = std::env::var("CORE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("groundwork-core listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
