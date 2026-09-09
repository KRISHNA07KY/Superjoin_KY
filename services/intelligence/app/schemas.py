"""Pydantic models for every endpoint. These mirror services/core/src/intelligence.rs
field-for-field — that Rust file is the request/response contract; this module
must match it exactly. The AnswerPlan section additionally mirrors
packages/ui-schema/answerPlan.ts, which is the generative-UI contract.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field


# ---------------- /pages/extract ----------------

class ExtractPagesRequest(BaseModel):
    document_id: str
    path: str


class ExtractedPage(BaseModel):
    page_number: int
    extraction_method: Literal["native", "ocr", "failed"]
    text: str
    confidence: Optional[float] = None
    layout: Optional[dict] = None


class ExtractPagesResponse(BaseModel):
    pages: list[ExtractedPage]
    page_count: int


# ---------------- /chunks/build ----------------

class PageInput(BaseModel):
    page_number: int
    text: str


class BuildChunksRequest(BaseModel):
    document_id: str
    pages: list[PageInput]


class BuiltChunk(BaseModel):
    page_start: int
    page_end: int
    text: str
    char_start: int
    char_end: int
    token_count: Optional[int] = None


class BuildChunksResponse(BaseModel):
    chunks: list[BuiltChunk]


# ---------------- /embed ----------------

class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dim: int
    model: str


# ---------------- /facts/extract ----------------

class KnownPredicate(BaseModel):
    canonical_name: str
    aliases: list[str] = Field(default_factory=list)


class ChunkInput(BaseModel):
    id: str
    text: str
    page_start: int
    page_end: int


class ExtractFactsRequest(BaseModel):
    document_id: str
    chunk: ChunkInput
    known_predicates: list[KnownPredicate]


class ExtractedFact(BaseModel):
    subject: str
    subject_type: Literal["org", "person", "place", "other"]
    predicate: str
    predicate_is_new: bool
    value_raw: str
    value_normalized: Optional[dict] = None
    time_type: Optional[str] = None
    time_value: Optional[str] = None
    scope: Optional[str] = None
    qualifiers: Optional[dict] = None
    confidence: float
    quote: str
    char_start: int
    char_end: int


class ExtractFactsResponse(BaseModel):
    facts: list[ExtractedFact]
    dropped_ungrounded: int = 0
    # Set when the Groq call itself failed (rate limit, network, etc.) rather
    # than legitimately finding nothing — Rust surfaces this in job metrics
    # so "0 facts" from a real failure is never confused with a clean chunk.
    extraction_error: Optional[str] = None


# ---------------- /entities/resolve ----------------

class EntityCandidate(BaseModel):
    id: str
    canonical_name: str
    entity_type: str


class ResolveEntityRequest(BaseModel):
    name: str
    candidates: list[EntityCandidate]


class ResolveEntityResponse(BaseModel):
    match_entity_id: Optional[str] = None
    confidence: float
    reasoning: str


# ---------------- /relationships/reason ----------------

class FactForReasoning(BaseModel):
    id: str
    subject: str
    predicate: str
    value_raw: str
    value_normalized: Optional[dict] = None
    time_type: Optional[str] = None
    time_value: Optional[str] = None
    scope: Optional[str] = None
    document_filename: str
    evidence_quote: str


RelationshipType = Literal[
    "CORROBORATES", "CONTRADICTS", "POTENTIAL_CONTRADICTION", "RECONCILES",
    "TEMPORAL_UPDATE", "UNIT_DIFFERENCE", "SCOPE_DIFFERENCE", "UNCERTAIN", "UNRELATED",
]


class ReasonRelationshipRequest(BaseModel):
    fact_a: FactForReasoning
    fact_b: FactForReasoning


class ReasonRelationshipResponse(BaseModel):
    relationship_type: RelationshipType
    explanation: str
    confidence: float


# ---------------- /answer/plan ----------------

class AnswerPlanRequest(BaseModel):
    question: str
    retrieved_facts: list[dict[str, Any]]
    retrieved_chunks: list[dict[str, Any]]
    # User-selectable from the composer's model picker. Defaults preserve
    # existing behavior for any caller that doesn't send these.
    provider: Literal["groq", "gemini"] = "groq"
    model: Optional[str] = None


class AnswerPlanResponse(BaseModel):
    plan: dict[str, Any]


# ---------------- generative UI component registry ----------------
# Mirrors packages/ui-schema/answerPlan.ts exactly. Used to validate the
# model's plan server-side before it's ever returned to Rust/the frontend.

class Citation(BaseModel):
    marker: str
    fact_id: Optional[str] = None
    evidence_id: Optional[str] = None
    # A citation pointing at a relationship rather than a specific piece of
    # evidence legitimately has no single document/page (observed live:
    # Gemini cited a cross-document contradiction this way) — tolerate that
    # instead of discarding an otherwise well-formed, evidence-grounded plan.
    document_id: Optional[str] = None
    page: Optional[int] = None
    label: Optional[str] = ""


class AnswerTextComponent(BaseModel):
    type: Literal["AnswerText"]
    text: str
    citations: list[Citation] = Field(default_factory=list)


class FactCardComponent(BaseModel):
    type: Literal["FactCard"]
    fact_id: str
    subject: str
    predicate: str
    value_display: str
    time_value: Optional[str] = None
    scope: Optional[str] = None
    confidence: float
    source_count: int = 1


class EvidenceCardComponent(BaseModel):
    type: Literal["EvidenceCard"]
    evidence_id: Optional[str] = None
    document_id: str
    document_filename: str
    page: int
    quote: str


class CorroborationCardComponent(BaseModel):
    type: Literal["CorroborationCard"]
    fact_ids: list[str]
    explanation: str
    confidence: float


class ConflictCardComponent(BaseModel):
    type: Literal["ConflictCard"]
    fact_a_id: str
    fact_b_id: str
    relationship_type: Literal["CONTRADICTS", "POTENTIAL_CONTRADICTION"]
    explanation: str
    confidence: float


class ReconciliationCardComponent(BaseModel):
    type: Literal["ReconciliationCard"]
    fact_a_id: str
    fact_b_id: str
    reason: str
    explanation: str
    confidence: float


class ComparisonRow(BaseModel):
    label: str
    value: str
    fact_id: Optional[str] = None


class ComparisonTableComponent(BaseModel):
    type: Literal["ComparisonTable"]
    title: Optional[str] = None
    rows: list[ComparisonRow]


class TimelineEvent(BaseModel):
    time_value: str
    value_display: str
    fact_id: Optional[str] = None


class TimelineComponent(BaseModel):
    type: Literal["Timeline"]
    subject: str
    events: list[TimelineEvent]


class EntityCardComponent(BaseModel):
    type: Literal["EntityCard"]
    entity_id: str
    name: str
    entity_type: str
    fact_count: int


class UncertaintyCardComponent(BaseModel):
    type: Literal["UncertaintyCard"]
    message: str
    reason: str


class RelationshipCardComponent(BaseModel):
    type: Literal["RelationshipCard"]
    relationship_id: Optional[str] = None
    fact_a_id: str
    fact_b_id: str
    relationship_type: str
    explanation: str
    confidence: float


class SourcePreviewComponent(BaseModel):
    type: Literal["SourcePreview"]
    document_id: str
    document_filename: str
    page: int
    quote: str
    fact_id: Optional[str] = None
    evidence_id: Optional[str] = None


UIComponent = Union[
    AnswerTextComponent, FactCardComponent, EvidenceCardComponent, CorroborationCardComponent,
    ConflictCardComponent, ReconciliationCardComponent, ComparisonTableComponent, TimelineComponent,
    EntityCardComponent, UncertaintyCardComponent, RelationshipCardComponent, SourcePreviewComponent,
]
# The discriminator belongs on the union itself, not on the `list[...]` that
# wraps it — annotate the union, then list the annotated type.
DiscriminatedUIComponent = Annotated[UIComponent, Field(discriminator="type")]


class AnswerPlan(BaseModel):
    components: list[DiscriminatedUIComponent]


def safe_answer_plan(raw: dict) -> dict:
    """Validate a model-generated plan; fall back to an honest UncertaintyCard
    rather than ever letting an unvalidated shape reach the frontend."""
    try:
        return AnswerPlan.model_validate(raw).model_dump(mode="json")
    except Exception:
        return AnswerPlan(
            components=[
                UncertaintyCardComponent(
                    type="UncertaintyCard",
                    message="I could not produce a well-formed answer for this question.",
                    reason="The generated response did not match the expected UI schema and was discarded rather than rendered unsafely.",
                )
            ]
        ).model_dump(mode="json")
