/**
 * Typed fetch wrappers for the Groundwork core API (services/core/src/routes/*.rs).
 * Base URL comes from NEXT_PUBLIC_API_URL (see apps/web/.env.local).
 *
 * Every non-2xx response is `{error: string}` — ApiError carries that message
 * so the UI can show an honest error instead of failing silently.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(
      `Could not reach the TrustLayer API at ${API_BASE}. Is the core service running?`,
      0,
    );
  }

  if (!res.ok) {
    let message = res.statusText || `request failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      // body wasn't JSON — fall back to statusText
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Shapes (mirrors services/core/src/models.rs) ----

export interface Document {
  id: string;
  filename: string;
  sha256: string;
  mime_type: string;
  page_count: number | null;
  status: string; // "uploaded" | "processing" | "ready" | "failed"
  uploaded_at: string;
  processed_at: string | null;
}

export interface UploadResponse {
  document: Document;
  deduplicated: boolean;
}

export type JobStage = 'extract_text' | 'chunk' | 'embed' | 'extract_facts' | 'reason_relationships' | string;
export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | string;

export interface ProcessingJob {
  id: string;
  document_id: string;
  stage: JobStage;
  status: JobStatus;
  error: string | null;
  metrics: unknown;
}

export interface DocPage {
  id: string;
  document_id: string;
  page_number: number;
  extraction_method: string;
  text: string;
  confidence: number | null;
  layout: unknown;
}

export interface RawFact {
  id: string;
  document_id: string;
  subject_entity_id: string | null;
  predicate_id: string | null;
  value_raw: string;
  value_normalized: unknown;
  time_type: string | null;
  time_value: string | null;
  scope: string | null;
  qualifiers: unknown;
  confidence: number;
  extraction_metadata: unknown;
  status: string;
  created_at: string;
}

export interface Evidence {
  id: string;
  fact_id: string;
  document_id: string;
  page_number: number;
  chunk_id: string | null;
  quote: string;
  char_start: number | null;
  char_end: number | null;
  bbox: unknown;
  ocr_confidence: number | null;
}

export interface FactView {
  id: string;
  document_id: string;
  document_filename: string;
  subject: string | null;
  predicate: string | null;
  value_raw: string;
  value_normalized: unknown;
  time_type: string | null;
  time_value: string | null;
  scope: string | null;
  confidence: number;
  evidence: Evidence[];
}

export interface Relationship {
  id: string;
  fact_a_id: string;
  fact_b_id: string;
  relationship_type: string; // CORROBORATES | CONTRADICTS | POTENTIAL_CONTRADICTION | RECONCILES | ...
  explanation: string;
  confidence: number;
  created_at: string;
}

export interface Entity {
  id: string;
  canonical_name: string;
  entity_type: string;
  normalized_key: string;
}

// ---- Documents ----

export function uploadDocument(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);
  return request<UploadResponse>('/documents', { method: 'POST', body: form });
}

export function listDocuments(): Promise<Document[]> {
  return request<Document[]>('/documents');
}

export function getDocument(id: string): Promise<Document> {
  return request<Document>(`/documents/${id}`);
}

/** Not fetched via `request` — used directly as an <iframe>/<embed> src. */
export function documentFileUrl(id: string, page?: number): string {
  const base = `${API_BASE}/documents/${id}/file`;
  return page ? `${base}#page=${page}` : base;
}

export function getDocumentJobs(id: string): Promise<ProcessingJob[]> {
  return request<ProcessingJob[]>(`/documents/${id}/jobs`);
}

export function getDocumentPages(id: string): Promise<DocPage[]> {
  return request<DocPage[]>(`/documents/${id}/pages`);
}

export function getDocumentFacts(id: string): Promise<RawFact[]> {
  return request<RawFact[]>(`/documents/${id}/facts`);
}

// ---- Facts ----

export function listFacts(): Promise<FactView[]> {
  return request<FactView[]>('/facts');
}

export function getFact(id: string): Promise<FactView> {
  return request<FactView>(`/facts/${id}`);
}

export function getFactEvidence(id: string): Promise<Evidence[]> {
  return request<Evidence[]>(`/facts/${id}/evidence`);
}

export function getFactRelationships(id: string): Promise<Relationship[]> {
  return request<Relationship[]>(`/facts/${id}/relationships`);
}

// ---- Relationships ----

export function listRelationships(): Promise<Relationship[]> {
  return request<Relationship[]>('/relationships');
}

// ---- Entities ----

export function listEntities(): Promise<Entity[]> {
  return request<Entity[]>('/entities');
}

export function getEntity(id: string): Promise<Entity> {
  return request<Entity>(`/entities/${id}`);
}

// ---- Query (generative UI) ----

export type LLMProvider = 'groq' | 'gemini';

/** Returns the raw answer-plan JSON — always validate with parseAnswerPlan() before rendering. */
export function query(question: string, provider: LLMProvider = 'groq'): Promise<unknown> {
  return request<unknown>('/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, provider }),
  });
}
