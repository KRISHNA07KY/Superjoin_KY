"""Picks which LLM provider backs a given call. Only /answer/plan is
provider-selectable from the frontend today (the composer's model picker) —
the ingestion-time endpoints (fact extraction, entity resolution,
relationship reasoning) stay on Groq via GROQ_MODEL, since they're
background-job calls with no interactive UI to pick a provider from.
"""
from __future__ import annotations

from typing import Any, Optional

from app import gemini_client, groq_client

PROVIDERS = ("groq", "gemini")
DEFAULT_PROVIDER = "groq"


def call_json(
    system: str,
    user: str,
    *,
    provider: str = DEFAULT_PROVIDER,
    model: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 3000,
    reasoning_effort: Optional[str] = None,
    retry_repair: bool = True,
) -> dict[str, Any]:
    if provider not in PROVIDERS:
        provider = DEFAULT_PROVIDER
    client = gemini_client if provider == "gemini" else groq_client
    return client.call_json(
        system, user, temperature=temperature, max_tokens=max_tokens,
        reasoning_effort=reasoning_effort, retry_repair=retry_repair, model=model,
    )
