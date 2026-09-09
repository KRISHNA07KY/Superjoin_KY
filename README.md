# Verity — Evidence-Backed Knowledge Workspace

Turns messy PDFs into a knowledge layer where **every claim resolves to a verified quote
on a known page**, and where documents that disagree are reconciled or escalated rather
than silently averaged.

> Built for the Superjoin VIT 2026 · Fact Knowledge Layer assignment.
> **Status is stated honestly throughout.** Where something is not implemented, this
> README says so rather than describing an intention as a feature.

---

## Setup and run instructions

Prerequisites: **Node 22+**, **Python 3.13**, **Rust (stable)**, and on Windows a C
toolchain for linking (see [ADR-001](docs/DECISIONS.md)).

```powershell
# 1. Python document-intelligence service (first run downloads ~130 MB of model weights)
py -m venv ai\.venv
ai\.venv\Scripts\python.exe -m pip install fastapi "uvicorn[standard]" pymupdf pydantic numpy fastembed
ai\.venv\Scripts\python.exe -m uvicorn ai.app.main:app --host 127.0.0.1 --port 8099

# 2. Rust core (Windows: put MinGW's bin on PATH first — see ADR-001)
$env:PATH = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;$env:PATH"
cd core; cargo build --release
$env:VERITY_STORAGE = "..\storage"; .\target\release\verity.exe

# 3. Web UI
cd web; npm install; npm run dev
```

Then open **http://localhost:3000**. `run.ps1` starts all three together.

Environment:

| Variable | Effect if unset |
|---|---|
| `DATABASE_URL` | Falls back to a JSON file store; `/health` says which is live |
| `NEO4J_URL`, `NEO4J_USER`, `NEO4J_PASSWORD` | Graph layer disabled; everything else works |
| `GROQ_API_KEY` | Ambiguous relationships stay `UNCERTAIN` rather than being adjudicated |

Nothing here fails hard when absent, except a `DATABASE_URL` that is set but unreachable —
that is a startup error, because silently writing somewhere the operator did not intend is
worse than not starting.

A synthetic evaluation corpus can be generated with
`ai\.venv\Scripts\python.exe eval\make_corpus.py`.

## Demo video

Not recorded.

---

## Problem

A document is not knowledge. Three PDFs about one company will state the same figure in
different units, contradict each other, and describe different periods using labels that
look interchangeable. Answering "what was FY2025 revenue, and do the sources agree?"
requires far more than retrieving a paragraph.

## Product / UX

A three-panel investigation workspace: corpus on the left, conversation in the centre,
evidence and conflicts on the right. Answers are assembled from a typed component
registry, so different questions produce genuinely different interfaces — a value lookup
returns fact cards, an agreement question returns corroboration and conflict cards plus a
comparison table, a temporal question returns a timeline. Every citation chip opens the
source PDF at the exact page with the cited region highlighted.

## Architecture

```
web/   Next.js + TypeScript   conversation · generative UI · PDF viewer
core/  Rust (Axum + Tokio)    API · pipeline · storage · retrieval · reasoning · LLM
ai/    Python (FastAPI)       PDF parsing · page triage · layout · embeddings
```

The boundary rule is **ecosystem advantage, not language preference**. Python owns PDF
parsing and local embedding models because PyMuPDF and `sentence-transformers` have no
mature Rust equivalent. Rust owns everything else — including the Groq calls, because
Groq is a plain HTTP API where Python offers no advantage, and keeping model calls beside
the scheduler keeps rate-limit accounting in one place.

Full reasoning in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Data model

`documents → pages → blocks → chunks`, and `entities`, `facts`, `evidence`,
`relationships`. Record shapes mirror the PostgreSQL schema in ARCHITECTURE.md §C.

Backed by PostgreSQL 17 (`core/migrations/0001_init.sql`). Structured-but-unqueried
values — a normalized quantity, an uncertainty report, the signal set behind a verdict —
are JSONB; everything the system filters, joins or orders by is a real column. A JSON file
backend remains available so the app still runs with no database, and `/health` always
reports which one is live.

## Document processing

`upload → fingerprint → parse → triage → chunk → embed → extract → verify evidence →
resolve entities → embed facts → relate affected neighbourhood`

Uploads are fingerprinted by SHA-256, so re-uploading the same bytes returns the existing
document instead of creating a duplicate that would appear to corroborate itself.

## OCR strategy

Pages are triaged, never blanket-OCR'd. Native text is scored on character density,
replacement-glyph ratio and image coverage; only pages scoring below the trust threshold
fall back to OCR — high-scoring pages keep native extraction's exact character geometry.

Tesseract 5.5 is wired in behind a swappable `OcrEngine` protocol
(`ai/app/parsing/ocr.py`), invoked via CLI TSV output for per-word bounding boxes and
confidence. A page with no usable native text at all is marked `ocr`; a page with some
native text plus an OCR fallback is marked `hybrid`. Verified end to end —
`eval/smoke_ocr.py` OCRs a page whose only content is a rasterized image (no text layer)
and recovers the sentence at 96% confidence with correctly-scaled geometry, measured in
[docs/EVALUATION.md](docs/EVALUATION.md#ocr). Nothing in the corpus used for the four
required cases needed OCR, so this path is verified independently of them.

## Embeddings / retrieval

Groq has no embeddings endpoint, so embeddings run locally: `bge-small-en-v1.5`, 384-d,
CPU. Free, rate-limit-free, and reproducible for evaluation. Verified working —
`eval/smoke_semantic.py` shows "turnover", "revenue from operations" and "total income"
all outranking distractors for a query containing none of those words.

Retrieval fuses four retrievers by **Reciprocal Rank Fusion**: semantic over chunks,
semantic over facts, lexical over chunks, and structured metadata matching. Ranks rather
than scores, because cosine distance and term-frequency scores are not on comparable
scales. Graph-style neighbourhood expansion runs last, enriching an already-relevant seed
set with related facts.

## Fact extraction

Deterministic, reusing the same normalization primitives the reasoning layer uses. Per
sentence: parse every quantity, assign each the period nearest to it, read backwards past
carrier verbs to find the metric, detect subject and scope. A model-assisted extractor is
designed as an addition, never a replacement — the system produces grounded facts with no
API key at all.

## Evidence / provenance

**The anti-hallucination gate.** A fact is only usable if the sentence it claims to come
from is actually found in its source chunk (exact, else normalized-fuzzy). The located
offsets are then projected through block geometry to a rectangle in PDF points. Failure
means the fact is stored, marked, and **excluded from citation**.

This is why the product can promise not to manufacture citations: it is not a prompt
instruction, it is that no code path can produce a citation without a matching evidence
row.

## Entity resolution

Names are normalized (casefold, strip legal suffixes), blocked, then scored on shared head
token and prefix containment. Equivalence is **an edge with a confidence, never a
destructive merge** — "Acme Ltd" and "Acme Corporation" may be different legal entities,
so a wrong decision is reversible by flipping one row. Mid-confidence links are recorded
as `proposed` and do not affect retrieval.

## Fact normalization

Original wording is never destroyed. Indian (lakh/crore) and Western (million/billion)
scale words both reduce to a canonical magnitude. Ambiguous currency symbols stay
ambiguous — `$` is never silently resolved to USD. Periods become half-open intervals, so
period comparison is arithmetic.

Fiscal convention is a parameter, not a constant, and facts derived under an assumed
convention are flagged and lose confidence.

## Cross-document reasoning

Two phases. Blocking on `(entity cluster, predicate key)` plus embedding recall generates
candidates. Then six deterministic signals — entity, predicate, time, unit, magnitude,
scope — drive a decision table. **Only genuinely ambiguous cells reach a model**, and even
then it receives the computed signals and must choose from a closed vocabulary.

This is the most important decision in the project: corroboration and reconciliation are
decided by arithmetic and interval algebra, so they cannot regress because a model had a
bad day.

## Graph knowledge layer

Neo4j 5.26, reached over the HTTP Query API, kept in step with PostgreSQL by a
**transactional outbox**: a change enqueues its graph mutation in the same PostgreSQL
transaction that made it, and a background worker drains that queue with idempotent
MERGEs keyed on the relational id. A crash therefore cannot leave the graph unaware of a
committed change, and a replayed batch converges rather than duplicating.

Verified against the corpus: 29 nodes and 58 edges across nine semantic edge types, and
the four-hop provenance walk resolves —

```
(:Entity)-[:ENTITY_SUPPORTS_FACT]->(:Fact)-[:FACT_SUPPORTED_BY_EVIDENCE]->(:Evidence)-[:FROM]->(:Document)
  Acme Industries Limited -> Revenue -> p.2 -> Acme Industries Limited — Annual Report
```

The graph is genuinely optional. With `NEO4J_URL` unset, `AnyGraph::from_env` installs
`NullGraph` and the product loses neighbourhood expansion and the explorer and nothing
else; the test suite runs against that provider to keep the claim honest. A configured
but unreachable Neo4j degrades to disabled with a warning rather than failing startup.
`POST /graph/sync` rebuilds the whole projection from PostgreSQL.

## Generative UI

The model never emits markup. The component tree is assembled in Rust from stored
records, validated, and rendered by a React switch over a discriminated union. Nothing is
`eval`'d or injected as HTML. An unrecognised component kind renders nothing.

## Required assignment cases

All four verified end to end against the corpus in `eval/corpus/`.

### 1. Corroboration — `CORROBORATED`, confidence 0.85

| | Fact A | Fact B |
|---|---|---|
| Source | Annual Report, p.1 | Investor Presentation, p.1 |
| Evidence | "reported consolidated revenue of Rs. 840 crore for FY2025" | "FY25 turnover reached Rs. 8.4 billion" |
| Normalized | 8.4 × 10⁹ INR, FY2025 | 8.4 × 10⁹ INR, FY2025 |

**Reasoning:** "turnover" maps to the `revenue` predicate key; `crore` (10⁷) and `billion`
(10⁹) both reduce to the same magnitude; `FY25` and `FY2025` resolve to the same interval.
Decided deterministically, with no model call.

### 2. Contradiction — `CONTRADICTS`, confidence 0.90

| | Fact A | Fact B |
|---|---|---|
| Source | Annual Report, p.1 | Analyst Note, p.1 |
| Evidence | "consolidated revenue of Rs. 840 crore for FY2025" | "consolidated revenue of Rs. 910 crore ... in FY2025" |

**Reasoning:** same entity, metric, period and stated scope; normalized values differ by
7.7%. No contextual explanation applies. Note that when scope is *not* stated on both
sides, the system returns `POTENTIAL_CONTRADICTION` or escalates instead — it will not
assert a contradiction it cannot justify.

### 3. Contextual reconciliation — `RECONCILES`, confidence 0.85

| | Fact A | Fact B |
|---|---|---|
| Source | Investor Presentation, p.2 | Investor Presentation / Analyst Note |
| Evidence | "Q1 2026 revenue was Rs. 80 crore" | "guidance of Rs. 320 crore for FY2026" |

**Reasoning:** Q1 FY2026 resolves to `[2025-04-01, 2025-07-01)` and FY2026 to
`[2025-04-01, 2026-04-01)`. Interval containment establishes that one period nests inside
the other, so the figures describe different spans and are not in conflict. Computed, not
inferred.

### 4. Extraction failure — flagged `extraction_uncertain`

Source: "Revenue increased 12% to Rs. 224 crore". The extractor produces `revenue = 12%`,
and the system **catches its own error**: the `revenue` predicate expects a currency
amount but received a percentage. The fact is quarantined, excluded from citations and
from relationship generation, and surfaced in an `UncertaintyCard` offering *Inspect
source · Reject this reading · Keep uncertain*, each persisted via `PATCH /facts/{id}`.

The detection is structural — a predicate/value type mismatch, plus mixed-kind rival
numbers in one sentence — not special-cased to this sentence.

## Engineering decisions

See [docs/DECISIONS.md](docs/DECISIONS.md) for the three ADRs: the Windows toolchain,
local embeddings, and deterministic-first adjudication.

## Why PostgreSQL + pgvector + a graph database

Three complementary jobs. **PostgreSQL** holds authoritative, transactional records and is
the only thing that must be right. **pgvector** serves semantic retrieval. **Neo4j** serves
traversal — the questions whose answer is a path of unknown length across mixed node
types, which are awkward as recursive SQL and natural as Cypher.

Two are live. pgvector is **not installed on the local instance**: the extension needs an
MSVC build on Windows and this machine has only MinGW. `Store::has_vector_index()` probes
`pg_extension` at startup and `/health` reports `vector_index: false`, so the system says
plainly that it is doing exact brute-force cosine rather than ANN. On a managed host such
as Neon the extension is present and the same probe reports true. At this corpus size
exact search is the *better* algorithm anyway — an HNSW index would be slower to build and
less accurate — but it is linear, so it is a development posture, not a scaling story.

## Trade-offs

- **Precision over recall.** Unverifiable facts are quarantined, not shown. The system
  misses real facts; that is the correct direction of error for a trust product.
- **Deterministic over clever.** Boring, tested comparison logic beats an agent.
- **Local embeddings over hosted.** Slower per batch; free, private, reproducible.
- **Exact vector search over ANN.** Correct at this corpus size, linear at scale.

## AI tools used

Built with Claude Code (Claude Opus 5).

## Limitations

Stated plainly:

1. **pgvector could not be installed locally.** It was attempted with the MinGW
   toolchain this project already uses (ADR-001) and failed on a header (`libintl.h`)
   the MSVC-built PostgreSQL server expects — the same MSVC dependency ADR-001 exists to
   avoid, and forcing it further risked crashing a database holding real data rather
   than genuinely fixing anything. Vector search is exact brute force rather than an ANN
   index; `/health` reports this (`vector_index: false`), and the extension is present
   automatically on a managed host such as Neon.
2. **A flush writes the whole corpus**, not a diff. Correct and transactional, but
   proportional to corpus size rather than to the change. The per-row `ON CONFLICT`
   statements are already shaped for incremental writes.
3. **Groq is integrated but never exercised** — no API key was available. Ambiguous
   relationships therefore resolve to `UNCERTAIN` rather than being adjudicated. This is
   by design rather than a crash, but the model-assisted path is unverified.
4. **The design system was not imported.** The intended source is a Claude Design project
   that requires an interactive `/design-login`. The current styling is provisional and
   token-based so it can be replaced without touching component logic.
5. **The evaluation corpus is synthetic.** The three real starter PDFs were not provided.
   No logic keys off filenames or document content, so swapping them in needs no code
   change.
6. **`POST /query` returns a complete response, not an SSE stream.** The streaming event
   contract is designed in ARCHITECTURE.md §F.
7. **Confidence values are signal-completeness scores, not calibrated probabilities**, and
   are labelled as such in the UI.
8. **Relationship generation is O(n²) over candidate pairs** after blocking. Fine at this
   size, not a scaling story.

OCR is no longer a limitation — Tesseract 5.5 is installed and wired in; see *OCR
strategy* above.

## Next steps

1. Add a Groq key and exercise the adjudication path.
2. Import the design system and replace the provisional tokens.
3. Provision a managed PostgreSQL with pgvector (e.g. Neon) and switch retrieval to an
   HNSW index behind the existing `has_vector_index` probe.
4. Narrow each flush to the affected document rather than the whole corpus.
5. Benchmark OCR accuracy against a larger, harder set of scanned pages than the one
   synthetic page in `docs/EVALUATION.md`.

## Additional notes

102 tests pass across the workspace (`cargo test --workspace`), covering unit and scale
normalization, currency ambiguity, fiscal-calendar conventions, interval algebra, the full
adjudication table, entity resolution, evidence verification, RRF, and all four assignment
cases. Several of these tests were written before the corresponding bug was found, and
caught real defects during development — a number regex that split `FY2025` into "202" and
"5", entity IDs orphaned across ingests, overlapping chunks causing a document to
corroborate itself, and a migration splitter that silently skipped the first table.

Measured, reproducible numbers for the corpus — extraction counts, evidence verification
rate, semantic-retrieval ranking, OCR recovery — are in
[docs/EVALUATION.md](docs/EVALUATION.md), each with the exact command that produced it.