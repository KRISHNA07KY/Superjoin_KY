from fastapi import FastAPI

from app.config import get_settings
from app.routers import pages, chunks, embeddings, facts, entities, relationships, answer

app = FastAPI(title="groundwork-intelligence", version="0.1.0")

app.include_router(pages.router)
app.include_router(chunks.router)
app.include_router(embeddings.router)
app.include_router(facts.router)
app.include_router(entities.router)
app.include_router(relationships.router)
app.include_router(answer.router)


@app.get("/health")
def health():
    settings = get_settings()
    return {
        "status": "ok",
        "service": "groundwork-intelligence",
        "groq_model": settings.groq_model,
        "embedding_model": settings.embedding_model,
        "groq_key_configured": bool(settings.groq_api_key),
    }
