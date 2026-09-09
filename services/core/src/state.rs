use crate::intelligence::IntelligenceClient;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub intelligence: IntelligenceClient,
    pub upload_dir: String,
}

impl AppState {
    pub async fn connect() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://groundwork:groundwork@localhost:5433/groundwork".into());
        let intelligence_url = std::env::var("INTELLIGENCE_URL")
            .unwrap_or_else(|_| "http://localhost:8000".into());
        let upload_dir_raw = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./data/documents".into());

        let db = PgPoolOptions::new()
            .max_connections(10)
            .connect(&database_url)
            .await?;

        sqlx::migrate!("../../infra/db/migrations").run(&db).await?;
        std::fs::create_dir_all(&upload_dir_raw)?;
        // Canonicalize to an absolute path: this path is sent to the Python
        // intelligence service, which runs as a separate process with its
        // own working directory, so a relative path would resolve wrong there.
        // On Windows, canonicalize() returns a `\\?\`-prefixed extended-length
        // path, which MuPDF's C file API (used by the Python service) can't
        // open — strip the prefix back off after resolving to absolute.
        let canonical = std::fs::canonicalize(&upload_dir_raw)?.to_string_lossy().into_owned();
        let upload_dir = canonical.strip_prefix(r"\\?\").unwrap_or(&canonical).to_string();

        Ok(Self {
            db,
            intelligence: IntelligenceClient::new(intelligence_url),
            upload_dir,
        })
    }
}
