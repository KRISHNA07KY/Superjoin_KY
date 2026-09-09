# Groundwork — Fact Knowledge Layer

An evidence-backed knowledge workspace: upload PDFs, and it extracts grounded facts, links every one to its exact source evidence, and figures out when facts across documents corroborate, contradict, or reconcile through context (period, scope, or unit differences). Built for the Superjoin VIT 2026 Engineering Intern hiring assignment.

## Setup and Run Instructions

**Prerequisites:** Rust (stable), Python 3.11+, Node 20+, Docker Desktop, a [Groq API key](https://console.groq.com/keys) (free tier).

```bash
# 1. Infrastructure (Postgres+pgvector, Neo4j)
docker compose up -d

# 2. Environment
cp .env.example .env                          # fill in GROQ_API_KEY
cp .env.example services/intelligence/.env    # same values

# 3. Intelligence service (Python)
cd services/intelligence
python -m venv .venv && .venv/Scripts/activate   # .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --port 8000
# (leave running — open a new terminal for the next steps)

# 4. Core API (Rust) — runs Postgres migrations automatically on startup
cd services/core
cargo run

# 5. Web app
cd apps/web
npm install
npm run dev
# -> http://localhost:3000
```

Optional: install [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) for the OCR fallback path (native-text-only extraction otherwise — see [OCR Strategy](#ocr-strategy)).

## Demo Video

_TODO: add the 3-minute demo video link before submission._

## Problem

Documents scattered across sources describe the same underlying reality in different words, units, and levels of precision — and sometimes genuinely disagree. A revenue figure quoted in one filing and a different figure in another might be the same fact restated, two different fiscal periods, or a real discrepancy. The brief: build a system that extracts meaningful facts from arbitrary PDFs, grounds every fact in the evidence it came from, and explains how facts across documents relate — without hard-coding anything about the specific starter documents.

## Product / UX

A dark, evidence-first research workspace (not a generic chatbot skin): a document sidebar with real per-stage processing status, a conversational center panel where answers are built from typed, evidence-linked components (not freeform prose), and a right-hand context panel that opens the exact PDF page behind any citation. A Fact Explorer and Conflict Explorer expose the underlying knowledge layer directly, so the system's structure is visible, not just its chat output.

## Architecture

```
apps/web            Next.js + TypeScript — chat workspace, generative-UI renderer, PDF viewer
services/core        Rust (Axum) — API, orchestration, Postgres/pgvector access, Neo4j sync
services/intelligence Python (FastAPI) — PDF extraction, OCR, chunking, embeddings, Groq-backed
                      fact extraction / entity resolution / relationship reasoning / answer planning
packages/design-system  Dark research-tool component library (tokens + React primitives)
packages/ui-schema      Shared generative-UI contract (zod on the TS side, Pydantic on the Python side)
infra/db/migrations     SQL schema (embedded and run by services/core at startup via sqlx)
```

**Why this split:** Rust owns all state and orchestration — it's the only thing that talks to Postgres, and it's what a production version of this would scale first (concurrent ingestion, connection pooling, job scheduling). Python is used only where its ecosystem is genuinely better: PDF/OCR libraries, sentence-transformers, and the Groq SDK. The intelligence service is stateless — every endpoint is a pure function of its request body — so Rust remains the single source of truth for what's actually been stored.

## Data Model

PostgreSQL is authoritative. Core tables: `documents`, `pages` (per-page text + extraction method + OCR confidence), `chunks` (+ pgvector embedding), `predicates` (a growing ontology, not a fixed enum — see [Fact Normalization](#fact-normalization)), `entities` + `entity_aliases` (confidence-scored, never silently merged), `facts` (subject/predicate/value/time/scope/qualifiers/confidence + embedding), `evidence` (quote + page + char offsets, verified as a real substring of the source text before a fact is ever persisted), `relationships` (typed, explained, confidence-scored fact-to-fact edges), `processing_jobs` (real per-stage status, not invented progress).

Full schema: [`infra/db/migrations/0001_init.sql`](infra/db/migrations/0001_init.sql).

## Document Processing

Upload → SHA-256 fingerprint (dedupes re-uploads) → per-page native-text extraction (PyMuPDF) with a word-density/image-area heuristic deciding whether a page needs OCR → paragraph-aware chunking (~600–900 estimated tokens, light overlap) with page/offset provenance retained throughout.

## OCR Strategy

OCR is not applied to every page — only pages where native extraction looks unreliable (very low text density, or a page dominated by image blocks). Tesseract (via pytesseract) is the OCR engine, chosen as a modular fallback behind a simple provider interface so it could be swapped for a cloud OCR/vision model later. **Honest limitation:** the development machine didn't have the Tesseract binary installed, so the OCR code path is implemented and unit-tested for graceful degradation (falls back to sparse native text rather than crashing) but wasn't exercised against a real scanned page end-to-end — the six starter PDFs are all native-text documents, so this didn't block the required cases.

A real, independently-discovered extraction bug: PyMuPDF occasionally mis-decodes non-ASCII glyphs (₹, curly quotes) from certain embedded fonts, producing mojibake (e.g. `â‚¹` instead of `₹`). Fixed by running extracted text through [`ftfy`](https://github.com/rspeer/python-ftfy) before it's chunked or shown to the LLM — otherwise it would silently corrupt facts and evidence quotes.

## Embeddings / Retrieval

Embeddings run locally via `sentence-transformers` (`BAAI/bge-small-en-v1.5`, 384-dim, L2-normalized) — no embedding API key, no per-query network dependency. pgvector (HNSW index, cosine distance) does the vector search. Query time: embed the question → vector search over both chunks and facts → build a compact evidence bundle → hand it to Groq for answer planning (see [Generative UI](#generative-ui)). This is deliberately not "send everything to the LLM": retrieval narrows to a small, relevant candidate set first.

## Fact Extraction

Groq (`openai/gpt-oss-20b`, configurable via `GROQ_MODEL`) extracts structured facts per chunk: subject, subject type, predicate, raw + normalized value, time type/value, scope, qualifiers, confidence, and — critically — a verbatim quote. **Every fact's quote is verified as an actual substring of the source chunk text before it is ever stored** (exact match first, then a whitespace-normalized fallback match); a fact whose quote can't be grounded is dropped and counted, never persisted. This ran in production against real Groq calls during development and did catch and drop hallucinated/misquoted facts — see [`services/intelligence/app/quote_grounding.py`](services/intelligence/app/quote_grounding.py).

The extraction prompt explicitly treats the document chunk as untrusted content, delimited and never interpreted as instructions — a defense against prompt injection from a malicious/adversarial PDF.

## Evidence / Provenance

Every fact carries at least one evidence row: document, page number, chunk, exact quote, and character offsets within the chunk. The `/documents/:id/file` endpoint streams the original PDF, and the frontend opens it directly to the cited page (`#page=N`) from any citation chip, fact card, or evidence card. Bounding-box highlighting is not implemented — the pipeline doesn't currently produce word-level coordinates — so evidence is grounded at the quote/page level, not pixel-region level (see [Limitations](#limitations-and-next-steps)).

## Entity Resolution

Candidate entities are pre-filtered in Postgres by trigram similarity (`pg_trgm`, capped top-K) before ever reaching an LLM call — this keeps resolution cheap and avoids comparing a new name against every entity in the system. Groq then makes the actual semantic judgment call given that short candidate list, and must return one of the given candidate IDs verbatim (a fabricated ID is treated as "no match," not trusted). Confidence ≥0.95 links as a strong alias; 0.75–0.94 records a lower-confidence alias without collapsing the two names into one canonical identity; below 0.75, a new entity is created. Nothing is ever silently merged.

## Fact Normalization

The predicate ontology (`predicates` table) starts empty and grows at extraction time: the model proposes a canonical predicate name only when nothing in the existing list matches semantically (this is the "schema evolves dynamically" behavior, implemented as a real mechanism rather than a flag). Units, currencies, and time periods are normalized into a `value_normalized` JSON object alongside the untouched original `value_raw` — the original wording is never discarded.

## Cross-document Reasoning

For each newly extracted fact, Postgres finds a small set of candidate related facts (same predicate, different document, ranked by embedding distance — never an all-pairs comparison). Each candidate pair is then sent to Groq with both facts' full context (values, time, scope, and their actual evidence quotes) and classified into one of: `CORROBORATES`, `CONTRADICTS`, `POTENTIAL_CONTRADICTION`, `RECONCILES`, `TEMPORAL_UPDATE`, `UNIT_DIFFERENCE`, `SCOPE_DIFFERENCE`, `UNCERTAIN`, `UNRELATED` — with an explanation grounded in the two quotes, not invented detail, and its own confidence score. `UNRELATED` pairs aren't stored.

## Graph Knowledge Layer

Neo4j is a **projection**, populated incrementally after each document's facts are committed to Postgres — never the source of truth, and the product keeps working with it disabled. Nodes: `Document`, `Entity`, `Fact`, `Evidence`. Edges carry semantic meaning: `(Fact)-[:ABOUT]->(Entity)`, `(Fact)-[:SUPPORTED_BY]->(Evidence)-[:FROM]->(Document)`, and typed fact-to-fact edges (`CORROBORATES`, `CONTRADICTS`, `RECONCILES`, etc. — validated against an allow-list before being interpolated into Cypher, since relationship *type* can't be parameterized). This answers genuinely graph-shaped questions ("what's connected to this entity," "trace this claim back to its sources") that a plain SQL query would make awkward — it is not used as the primary UI.

## Generative UI

The LLM never emits HTML or JavaScript. `/query` returns a JSON "answer plan" — a list of typed components (`AnswerText`, `FactCard`, `EvidenceCard`, `CorroborationCard`, `ConflictCard`, `ReconciliationCard`, `ComparisonTable`, `Timeline`, `EntityCard`, `UncertaintyCard`, `RelationshipCard`, `SourcePreview`) — validated server-side against a Pydantic schema and again client-side against the mirrored zod schema ([`packages/ui-schema/answerPlan.ts`](packages/ui-schema/answerPlan.ts)) before anything renders. An invalid or unrecognized plan falls back to an honest `UncertaintyCard`, never raw/unvalidated output. Citation markers in `AnswerText` carry real `document_id`/`page`/`fact_id`/`evidence_id` values pulled from retrieved data — the model is explicitly instructed never to invent one.

## Required Assignment Cases

All facts below are real, grounded output from the running system (real Groq calls, real PDFs) — see `scripts/eval/make_synthetic_pdfs.py` for the controlled dataset and `starter-datasets/delhivery/` for the real one. **Honest status:** extraction (facts + evidence) was fully verified live against both datasets. Relationship *classification* (corroborate/contradict/reconcile) is implemented and code-reviewed but was not verified end-to-end today — three different Groq models (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`) were exhausted in succession against this free-tier key's daily token budget during development/testing, documented honestly rather than glossed over (see [Trade-offs](#trade-offs)). The facts below are real; the relationship type each pair *should* produce is stated based on the reasoning rules in [`services/intelligence/app/routers/relationships.py`](services/intelligence/app/routers/relationships.py), pending a live re-run once quota resets or a paid key is supplied.

### 1. Corroboration
- Fact A: `Acme Retail Holdings Ltd. | revenue | Rs. 840 crore | FY2025` — evidence: *"Consolidated revenue for the financial year 2025 was Rs. 840 crore..."* (`01-corroboration-annual-report.pdf`)
- Fact B: `Acme Retail Holdings | turnover | INR 8.4 billion | FY25` — evidence: *"FY25 turnover reached INR 8.4 billion..."* (`01-corroboration-investor-deck.pdf`)
- Expected classification: `CORROBORATES` (₹840 crore = ₹8.4 billion — same magnitude, same period, different unit/wording).

### 2. Contradiction
- Fact A: `Acme Retail Holdings Ltd. | revenue | Rs. 840 crore | FY2025` (`01-corroboration-annual-report.pdf`)
- Fact B: `Acme Retail Holdings Ltd. | revenue | Rs. 910 crore | FY2025` — evidence: *"Acme Retail Holdings today announced FY2025 consolidated revenue of Rs. 910 crore..."* (`02-contradiction-press-release.pdf`)
- Expected classification: `CONTRADICTS` / `POTENTIAL_CONTRADICTION` (same entity, metric, period, scope — no obvious reconciling factor).

### 3. Contextual Reconciliation
- Fact A: `Acme Retail Holdings Ltd. | revenue | Rs. 80 crore | Q1 FY2026` (`03-reconciliation-q1-update.pdf`)
- Fact B: FY2026 full-year guidance of Rs. 320 crore (`03-reconciliation-fy-guidance.pdf`) — extraction of this specific fact hit the same quota exhaustion noted above before it could be verified live.
- Expected classification: `RECONCILES` (a quarter is a subset of its fiscal year — no genuine conflict).

### 4. Extraction / Reasoning Failure (real, found on the actual starter dataset)
On `starter-datasets/delhivery/02-delhivery-annual-report-fy24-excerpt.pdf`, page 1, the system extracted:
- `Part-truckload freight delivered since inception = 98,135` (quote: `"98,135"`)
- `Workforce strength = >4.8Mn tonnes` (quote: `">4.8Mn tonnes"`)

Both are genuinely grounded (each quote is a real, verified substring of the source page), but the labels are **swapped**: 98,135 is actually Delhivery's workforce headcount, and 4.8Mn tonnes is PTL freight tonnage — confirmed by cross-referencing the same page's other figures. This is a real infographic-layout extraction failure: the page presents icon+number+label triples visually, but PyMuPDF's text extraction linearizes them in an order that decouples a number from its true label, and the LLM paired adjacent-but-wrong number/label pairs. **How this is currently handled:** the hallucination guard correctly verifies the quote exists (so the system doesn't claim to have invented the number), but nothing yet flags a "quote is verbatim but the semantic pairing is likely wrong" case — that would require reasoning over the page's layout/geometry, not just its linearized text. **How to improve it:** retain PyMuPDF's block/line bounding boxes through chunking (already captured, currently discarded) and require number↔label spatial proximity, or route infographic-dense pages through a vision-capable model instead of text-only extraction.

## Engineering Decisions

- **Rust owns all Postgres writes; Python is a stateless computation service.** Keeps one source of truth and one place that enforces invariants (e.g. the hallucination guard is re-checked in Rust even though Python already checks it — defense in depth).
- **Runtime-checked SQL (`sqlx::query`, not the compile-time `query!` macro).** `cargo build` never requires a live database connection.
- **The generative-UI schema is authored once (by hand) and mirrored, not derived**, in TypeScript (zod) and Python (Pydantic) — both must validate before a plan is trusted.
- **Absolute paths between services.** The Python service runs as a separate OS process from Rust; a relative upload path resolved from the wrong working directory silently broke PDF loading during development — now Rust always canonicalizes and sends an absolute path.

## Why PostgreSQL + pgvector + Graph Database

PostgreSQL+pgvector is the system of record because this is fundamentally relational/structured data (documents, pages, facts, evidence) that also needs semantic search — one database, one transaction boundary, no dual-write consistency problem. Neo4j is added *in addition to*, not instead of, that store, specifically because a few real product questions ("what's connected to this entity," "trace this fact back through its relationships") are naturally graph traversals that would otherwise mean recursive CTEs or N+1 queries. It's disabled-safe by design: every write to it happens after the corresponding Postgres write succeeds, and a Neo4j failure is logged and swallowed, never a reason to fail the pipeline.

## Trade-offs

- **Groq's free tier has a hard daily per-model token budget** (hit during development on `openai/gpt-oss-120b` after processing ~1.5 real documents — see the rate-limit handling in `groq_client.py`). Switched the default to the smaller `openai/gpt-oss-20b` to get more throughput per day; a paid tier or a dedicated key removes this ceiling entirely.
- **No bounding-box evidence highlighting.** Evidence is grounded to a page + exact quote, not a pixel region — the citation still opens the exact page, but doesn't draw a highlight box over the exact words.
- **Whole-file uploads, no resumable/chunked upload** — fine for the ~1–7MB starter PDFs, would need revisiting for very large files.
- **No streaming answer responses** — `/query` returns the whole answer plan at once rather than incrementally.

## AI Tools Used

Built with Claude Code (Anthropic) as the primary coding agent. In-product LLM work runs on Groq-hosted open models (`openai/gpt-oss-20b`/`120b`) for fact extraction, entity resolution, and relationship reasoning during ingestion. The chat composer additionally has a **Groq / Gemini** picker for interactive answer-planning (`/query`) — both providers go through the same schema-validated generative-UI contract (`services/intelligence/app/llm_router.py` dispatches to `groq_client.py` or `gemini_client.py`, both verified against their real APIs, not assumed). Local `sentence-transformers` embeddings — no embedding API.

## Limitations and Next Steps

**Doesn't work yet / known gaps:**
- Bounding-box-level evidence highlighting (page-level only today).
- OCR wasn't exercised against a real scanned document in this environment (Tesseract not installed locally) — the fallback path is implemented and degrades gracefully, but unverified against genuinely scanned pages.
- No resumable uploads for very large PDFs; no incremental re-processing UI if a document changes.
- Relationship reasoning only compares facts sharing the same normalized predicate — a real semantic match across differently-named predicates (before the ontology has converged) can be missed until the predicate names align.

**Next steps:** word-level bounding boxes (PyMuPDF already exposes them; just needs plumbing through chunking → fact offsets → frontend highlight overlay); a real graph-explorer UI beyond the Conflict Explorer; incremental re-processing when a new document affects existing facts' relationships rather than only comparing forward from the new document.

## Additional Notes

The design system (component architecture, token pipeline) was adapted from an existing unrelated project's design system, restyled from a playful light theme to this dark, restrained research-tool aesthetic — same architecture, entirely new visual language, no shared branding or content.
