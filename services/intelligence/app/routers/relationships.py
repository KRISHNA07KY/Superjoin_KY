"""POST /relationships/reason — given two facts (with their evidence quotes and
document provenance), call Groq to classify their relationship and produce an
explanation grounded in the evidence.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter

from app.config import get_settings
from app.llm_router import call_json
from app.schemas import ReasonRelationshipRequest, ReasonRelationshipResponse

logger = logging.getLogger("groundwork.relationships")

router = APIRouter()

_SYSTEM = """You are a fact-comparison analyst for a document knowledge base.

You will be given two facts extracted from different documents. Your job is to
classify how they relate and write a concise, evidence-grounded explanation.

Return ONLY a JSON object with keys:
  relationship_type – one of: CORROBORATES, CONTRADICTS, POTENTIAL_CONTRADICTION,
                      RECONCILES, TEMPORAL_UPDATE, UNIT_DIFFERENCE, SCOPE_DIFFERENCE,
                      UNCERTAIN, UNRELATED
  explanation       – string: 1-3 sentences. Must reference specific values and their sources.
  confidence        – float 0.0–1.0: your confidence in the classification

Definitions:
  CORROBORATES         – Both facts assert the same real-world value (possibly in different words/units).
  CONTRADICTS          – The facts assert genuinely incompatible values for the same quantity & period.
  POTENTIAL_CONTRADICTION – Looks like a contradiction but could be reconciled with more context.
  RECONCILES           – Apparent mismatch is fully explained (different scope, period, or unit — explain which).
  TEMPORAL_UPDATE      – One fact is a newer estimate/revision of the same metric; the older one is superseded.
  UNIT_DIFFERENCE      – Same value expressed in different units (e.g., Cr vs million); show the conversion.
  SCOPE_DIFFERENCE     – Same entity but different scope (e.g., total headcount vs permanent employees).
  UNCERTAIN            – Cannot determine the relationship without more context.
  UNRELATED            – The facts are about different subjects/metrics; no meaningful comparison.

Be especially careful to distinguish:
  - CORROBORATES (same value, agree) vs CONTRADICTS (same metric, disagree)
  - RECONCILES (different scope/period/unit that EXPLAINS the apparent gap) vs CONTRADICTS (irreconcilable)
  - TEMPORAL_UPDATE vs RECONCILES

If the facts look unrelated (different entities, entirely different predicates), return UNRELATED.
"""


@router.post("/relationships/reason", response_model=ReasonRelationshipResponse)
def reason_relationship(req: ReasonRelationshipRequest) -> ReasonRelationshipResponse:
    def fmt(f) -> str:
        return (
            f"  Document: {f.document_filename}\n"
            f"  Subject:  {f.subject}\n"
            f"  Predicate:{f.predicate}\n"
            f"  Value:    {f.value_raw}\n"
            f"  Normalized: {f.value_normalized}\n"
            f"  Time:     {f.time_type} / {f.time_value}\n"
            f"  Scope:    {f.scope}\n"
            f"  Quote:    \"{f.evidence_quote}\"\n"
        )

    user_msg = f"Fact A:\n{fmt(req.fact_a)}\nFact B:\n{fmt(req.fact_b)}"

    # Deliberately NOT catching GroqCallError here: a relationship this
    # endpoint couldn't actually reason about must not be recorded as a
    # real (if low-confidence) "UNCERTAIN" relationship — that would let a
    # rate-limit/network failure masquerade as a genuine model judgment.
    # Propagating the error lets Rust's pipeline fail the reason_relationships
    # job visibly instead.
    # Kept conservative: some Groq models enforce a low output-tokens-per-
    # minute ceiling (observed: qwen3.8-27b caps at 1000 OTPM) independent of
    # the daily/TPM budget used elsewhere.
    raw = call_json(
        _SYSTEM, user_msg, provider=get_settings().extraction_provider,
        temperature=0.15, max_tokens=900, reasoning_effort="low",
    )

    valid_types = {
        "CORROBORATES", "CONTRADICTS", "POTENTIAL_CONTRADICTION",
        "RECONCILES", "TEMPORAL_UPDATE", "UNIT_DIFFERENCE", "SCOPE_DIFFERENCE",
        "UNCERTAIN", "UNRELATED",
    }
    rel_type = str(raw.get("relationship_type", "UNCERTAIN")).upper()
    if rel_type not in valid_types:
        rel_type = "UNCERTAIN"

    return ReasonRelationshipResponse(
        relationship_type=rel_type,
        explanation=str(raw.get("explanation", "")),
        confidence=float(raw.get("confidence", 0.5)),
    )
