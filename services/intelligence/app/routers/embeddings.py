"""POST /embed — sentence-transformers embeddings via the lazy singleton in
app/embeddings.py."""
from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.embeddings import embed_texts
from app.schemas import EmbedRequest, EmbedResponse

router = APIRouter()


@router.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    settings = get_settings()
    embeddings, dim = embed_texts(req.texts)
    return EmbedResponse(embeddings=embeddings, dim=dim, model=settings.embedding_model)
