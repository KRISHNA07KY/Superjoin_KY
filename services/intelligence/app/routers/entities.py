"""POST /entities/resolve — given a name and a list of existing entity candidates,
use Groq to decide whether the name refers to an existing entity (and if so, which
one at what confidence) or is genuinely a new entity.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter

from app.config import get_settings
from app.llm_errors import LLMCallError as GroqCallError
from app.llm_router import call_json
from app.schemas import ResolveEntityRequest, ResolveEntityResponse

logger = logging.getLogger("groundwork.entities")

router = APIRouter()

_SYSTEM = """You are an entity resolution expert for a knowledge base.

Given a new name and a list of existing entities, determine whether the new name
refers to an existing entity in the list or is a genuinely different entity.

Return ONLY a JSON object with keys:
  match_entity_id – string UUID of the best matching entity, or null if no match
  confidence      – float 0.0–1.0: confidence that match_entity_id is the same real-world entity
  reasoning       – string: brief explanation of your decision

Rules:
- A confidence >= 0.95 means you are almost certain it is the same entity (e.g. same org, minor name variation).
- A confidence of 0.75–0.94 means likely the same entity (the Rust layer will record it as a low-confidence alias rather than a hard merge).
- A confidence < 0.75 means treat as a different entity (set match_entity_id to null).
- Do NOT merge entities that are genuinely different organizations or people even if their names are similar.
- If the list is empty or none match, return {match_entity_id: null, confidence: 0.0, reasoning: "no candidates"}.
"""


@router.post("/entities/resolve", response_model=ResolveEntityResponse)
def resolve_entity(req: ResolveEntityRequest) -> ResolveEntityResponse:
    candidates_text = "\n".join(
        f"  - id={c.id} name={c.canonical_name!r} type={c.entity_type}"
        for c in req.candidates
    )
    user_msg = (
        f"New name to resolve: {req.name!r}\n\n"
        f"Existing entity candidates:\n{candidates_text or '  (none)'}"
    )

    try:
        raw = call_json(
            _SYSTEM, user_msg, provider=get_settings().extraction_provider,
            temperature=0.1, max_tokens=600, reasoning_effort="low",
        )
    except GroqCallError as exc:
        # Degrade to "no match" rather than aborting the caller's whole
        # document pipeline over a transient/rate-limited resolution call —
        # the entity is simply created fresh instead of linked.
        logger.error("Entity resolution call failed for name=%r: %s", req.name, exc)
        return ResolveEntityResponse(match_entity_id=None, confidence=0.0, reasoning=f"resolution unavailable: {exc}")

    match_id = raw.get("match_entity_id")
    if match_id == "null" or not isinstance(match_id, str) or not match_id:
        match_id = None
    elif match_id not in {c.id for c in req.candidates}:
        # The model must choose from the candidates it was given — an id
        # that isn't in that list is a hallucination, not a real match.
        logger.warning("Groq returned match_entity_id %r not in candidate set; treating as no match", match_id)
        match_id = None

    confidence = float(raw.get("confidence", 0.0)) if match_id else 0.0
    reasoning = str(raw.get("reasoning", ""))

    return ResolveEntityResponse(
        match_entity_id=match_id,
        confidence=confidence,
        reasoning=reasoning,
    )
