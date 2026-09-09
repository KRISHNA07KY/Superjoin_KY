-- Groundwork core schema. PostgreSQL is the authoritative store; Neo4j (see
-- graph_sync_log) is a projection kept incrementally in sync, never the other
-- way around.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  page_count INT,
  status TEXT NOT NULL DEFAULT 'uploaded', -- uploaded|processing|ready|failed
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  extraction_method TEXT NOT NULL, -- native|ocr|hybrid|failed
  text TEXT NOT NULL DEFAULT '',
  confidence REAL,
  layout JSONB,
  UNIQUE (document_id, page_number)
);

-- Predicate ontology. Seeded empty on purpose: the extractor proposes a
-- predicate at fact-extraction time, and it is inserted here only if it
-- doesn't already match an existing one (name or alias) above a similarity
-- threshold. This is how the schema "evolves dynamically" rather than being
-- a hard-coded enum.
CREATE TABLE predicates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  value_type TEXT NOT NULL DEFAULT 'numeric', -- numeric|categorical|date|text
  unit_class TEXT, -- currency|percentage|count|ratio|other
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'other', -- org|person|place|other
  normalized_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_key, entity_type)
);

CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_start INT NOT NULL,
  page_end INT NOT NULL,
  text TEXT NOT NULL,
  char_start INT NOT NULL,
  char_end INT NOT NULL,
  token_count INT,
  embedding vector(384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aliases are never silently merged into a canonical entity: a low-confidence
-- link stays visible as a "possible alias" in the UI rather than collapsing
-- two distinct real-world entities.
CREATE TABLE entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  source_chunk_id UUID REFERENCES chunks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  subject_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  predicate_id UUID REFERENCES predicates(id) ON DELETE SET NULL,
  value_raw TEXT NOT NULL,
  value_normalized JSONB,
  time_type TEXT, -- fiscal_year|calendar_year|quarter|date|range|unspecified
  time_value TEXT,
  scope TEXT,
  qualifiers JSONB NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL,
  extraction_metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(384),
  status TEXT NOT NULL DEFAULT 'active', -- active|superseded|rejected
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A fact is only ever persisted alongside evidence whose quote has been
-- verified as a real substring of the source page/chunk text (hallucination
-- guard enforced in the intelligence service before this row is written).
CREATE TABLE evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  chunk_id UUID REFERENCES chunks(id) ON DELETE SET NULL,
  quote TEXT NOT NULL,
  char_start INT,
  char_end INT,
  bbox JSONB,
  ocr_confidence REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_a_id UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  fact_b_id UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  explanation TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fact_a_id <> fact_b_id)
);
CREATE UNIQUE INDEX relationships_unique_pair
  ON relationships (LEAST(fact_a_id, fact_b_id), GREATEST(fact_a_id, fact_b_id));

CREATE TABLE processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, -- ingest|extract_text|chunk|embed|extract_facts|resolve_entities|normalize|pair_candidates|reason_relationships|graph_sync
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|done|failed
  error TEXT,
  metrics JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE graph_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type TEXT NOT NULL, -- Document|Entity|Fact|Evidence
  node_id UUID NOT NULL,
  operation TEXT NOT NULL, -- upsert|delete
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pages_document ON pages(document_id);
CREATE INDEX idx_chunks_document ON chunks(document_id);
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_facts_document ON facts(document_id);
CREATE INDEX idx_facts_subject ON facts(subject_entity_id);
CREATE INDEX idx_facts_predicate ON facts(predicate_id);
CREATE INDEX idx_facts_embedding ON facts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_facts_text_trgm ON facts USING gin (value_raw gin_trgm_ops);
CREATE INDEX idx_evidence_fact ON evidence(fact_id);
CREATE INDEX idx_relationships_fact_a ON relationships(fact_a_id);
CREATE INDEX idx_relationships_fact_b ON relationships(fact_b_id);
CREATE INDEX idx_processing_jobs_document ON processing_jobs(document_id);
CREATE INDEX idx_entity_aliases_entity ON entity_aliases(entity_id);
CREATE INDEX idx_entities_normalized_key ON entities(normalized_key);
