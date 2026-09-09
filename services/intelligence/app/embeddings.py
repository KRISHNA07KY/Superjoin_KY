"""Lazy singleton wrapper around the sentence-transformers embedding model.

Loading a sentence-transformers model is slow (seconds), so we load it once
at first use and reuse it for every subsequent request rather than reloading
per-request.
"""
from __future__ import annotations

import logging
from threading import Lock
from typing import Optional

from app.config import get_settings

logger = logging.getLogger("groundwork.embeddings")

_model = None
_model_lock = Lock()


def get_embedding_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from sentence_transformers import SentenceTransformer

                settings = get_settings()
                logger.info("Loading embedding model %s ...", settings.embedding_model)
                _model = SentenceTransformer(settings.embedding_model)
                logger.info("Embedding model loaded.")
    return _model


def embed_texts(texts: list[str]) -> tuple[list[list[float]], int]:
    """Returns (embeddings, dim). Empty input returns ([], 0) without
    touching the model."""
    if not texts:
        return [], 0

    model = get_embedding_model()
    vectors = model.encode(texts, normalize_embeddings=True)
    embeddings = [v.tolist() for v in vectors]
    dim = len(embeddings[0]) if embeddings else 0
    return embeddings, dim
