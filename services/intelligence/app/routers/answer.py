"""POST /answer/plan — given a question and retrieved facts/chunks, call Groq
to produce a structured "answer plan" (a list of typed UI components from the
component registry). The plan is validated against the Pydantic schema before
being returned, so only well-formed shapes reach Rust and the frontend.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter

from app.config import get_settings
from app.llm_errors import LLMCallError
from app.llm_router import call_json
from app.schemas import AnswerPlanRequest, AnswerPlanResponse, safe_answer_plan

logger = logging.getLogger("groundwork.answer")

router = APIRouter()

_SYSTEM = """You are the answer-planning module of a document knowledge system called Groundwork.
You must return a JSON answer plan — a structured response that a typed UI renderer will display.

The plan is a JSON object: {"components": [ ... ]}

Each component must have a "type" field that is EXACTLY one of:
  AnswerText, FactCard, EvidenceCard, CorroborationCard, ConflictCard,
  ReconciliationCard, ComparisonTable, Timeline, EntityCard, UncertaintyCard,
  RelationshipCard, SourcePreview

Component schemas:

AnswerText: {type:"AnswerText", text:"...", citations:[{marker:"[1]", fact_id, evidence_id, document_id, page, label}]}
FactCard: {type:"FactCard", fact_id, subject, predicate, value_display, time_value?, scope?, confidence, source_count}
EvidenceCard: {type:"EvidenceCard", evidence_id?, document_id, document_filename, page, quote}
CorroborationCard: {type:"CorroborationCard", fact_ids:[...], explanation, confidence}
ConflictCard: {type:"ConflictCard", fact_a_id, fact_b_id, relationship_type:"CONTRADICTS"|"POTENTIAL_CONTRADICTION", explanation, confidence}
ReconciliationCard: {type:"ReconciliationCard", fact_a_id, fact_b_id, reason:"scope"|"period"|"unit"|"vintage", explanation, confidence}
ComparisonTable: {type:"ComparisonTable", title?, rows:[{label, value, fact_id?}]}
Timeline: {type:"Timeline", subject, events:[{time_value, value_display, fact_id?}]}
EntityCard: {type:"EntityCard", entity_id, name, entity_type, fact_count}
UncertaintyCard: {type:"UncertaintyCard", message, reason}
RelationshipCard: {type:"RelationshipCard", relationship_id?, fact_a_id, fact_b_id, relationship_type, explanation, confidence}
SourcePreview: {type:"SourcePreview", document_id, document_filename, page, quote, fact_id?, evidence_id?}

RULES:
1. Always start with an AnswerText component that answers the question concisely in prose.
2. Use citation markers [1], [2], ... inline in AnswerText.text and fill the citations array.
3. Use the most specific component type available (e.g., ConflictCard for contradictions, not generic text).
4. If a fact has relationship_type CORROBORATES → use CorroborationCard.
5. If CONTRADICTS or POTENTIAL_CONTRADICTION → use ConflictCard.
6. If RECONCILES, SCOPE_DIFFERENCE, UNIT_DIFFERENCE, TEMPORAL_UPDATE → use ReconciliationCard.
7. Only use UncertaintyCard if you genuinely cannot answer from the provided evidence.
8. Never make up fact_ids, evidence_ids, document_ids, or page numbers. Use ONLY values from the provided data.
9. Prefer depth over breadth: a focused answer with 3-5 well-chosen components beats a sprawling list.
"""


@router.post("/answer/plan", response_model=AnswerPlanResponse)
def answer_plan(req: AnswerPlanRequest) -> AnswerPlanResponse:
    facts_json = json.dumps(req.retrieved_facts, indent=2, default=str)
    chunks_json = json.dumps(req.retrieved_chunks, indent=2, default=str)

    user_msg = (
        f"Question: {req.question}\n\n"
        f"Retrieved facts (with relationships):\n{facts_json}\n\n"
        f"Retrieved chunks (raw text snippets):\n{chunks_json}"
    )

    # Some Groq models enforce a low output-tokens-per-minute ceiling
    # independent of their daily budget (observed: qwen3.8-27b caps at 1000
    # OTPM) — 3000 blew straight through that and turned into a user-visible
    # "couldn't generate an answer" every time that model was active. Gemini
    # doesn't share that constraint, so it gets more headroom.
    max_tokens = 3000 if req.provider == "gemini" else 900
    # Use the caller's explicit model if given; otherwise pick a per-provider
    # default suited to this specific call (see groq_answer_model's comment).
    model = req.model or (get_settings().groq_answer_model if req.provider == "groq" else None)
    try:
        raw = call_json(
            _SYSTEM, user_msg, provider=req.provider, model=model,
            temperature=0.3, max_tokens=max_tokens, reasoning_effort="low",
        )
    except LLMCallError as exc:
        logger.error("Answer planning call failed (%s): %s", req.provider, exc)
        raw = {
            "components": [
                {
                    "type": "UncertaintyCard",
                    "message": "I couldn't generate an answer right now.",
                    "reason": f"The reasoning service is temporarily unavailable ({exc}).",
                }
            ]
        }

    # safe_answer_plan validates against the full UIComponent discriminated union
    # and falls back to an UncertaintyCard rather than returning malformed output.
    validated = safe_answer_plan(raw)
    if validated["components"][0].get("type") == "UncertaintyCard" and raw.get("components"):
        # The model DID produce something, it just didn't validate — log the
        # raw shape (not just "discarded") so this is debuggable instead of
        # a silent, unexplained fallback every time.
        logger.warning("answer plan failed schema validation, raw=%s", json.dumps(raw)[:2000])

    return AnswerPlanResponse(plan=validated)
