import { z } from 'zod';

/**
 * The generative-UI contract (CLAUDE.md §15/§16). An LLM never emits HTML/JS
 * — it emits JSON matching this schema, which the frontend validates before
 * rendering through a fixed component registry. Any component whose `type`
 * isn't one of these, or whose shape fails validation, is dropped in favor
 * of a safe fallback — never rendered raw.
 *
 * This file is the source of truth. services/intelligence/app/schemas.py
 * mirrors it field-for-field in Pydantic; keep the two in sync by hand.
 */

const Citation = z.object({
  marker: z.string(), // token that appears inline in AnswerText.text, e.g. "1"
  fact_id: z.string().uuid().optional(),
  evidence_id: z.string().uuid().optional(),
  // A citation pointing at a relationship rather than a specific piece of
  // evidence legitimately has no single document/page — tolerate null/
  // missing rather than reject an otherwise well-formed plan over it.
  document_id: z.string().uuid().nullable().optional(),
  page: z.number().int().positive().nullable().optional(),
  label: z.string().nullable().optional().default(''), // e.g. "Annual Report · p.47"
});
export type Citation = z.infer<typeof Citation>;

const AnswerText = z.object({
  type: z.literal('AnswerText'),
  text: z.string(), // may contain inline markers like [1], [2] matching citations[].marker
  citations: z.array(Citation).default([]),
});

const FactCard = z.object({
  type: z.literal('FactCard'),
  fact_id: z.string().uuid(),
  subject: z.string(),
  predicate: z.string(),
  value_display: z.string(), // e.g. "₹8,142 Cr"
  time_value: z.string().optional(),
  scope: z.string().optional(),
  confidence: z.number().min(0).max(1),
  source_count: z.number().int().min(0).default(1),
});

const EvidenceCard = z.object({
  type: z.literal('EvidenceCard'),
  evidence_id: z.string().uuid().optional(),
  document_id: z.string().uuid(),
  document_filename: z.string(),
  page: z.number().int().positive(),
  quote: z.string(),
});

const CorroborationCard = z.object({
  type: z.literal('CorroborationCard'),
  fact_ids: z.array(z.string().uuid()).min(2),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
});

const ConflictCard = z.object({
  type: z.literal('ConflictCard'),
  fact_a_id: z.string().uuid(),
  fact_b_id: z.string().uuid(),
  relationship_type: z.enum(['CONTRADICTS', 'POTENTIAL_CONTRADICTION']),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
});

const ReconciliationCard = z.object({
  type: z.literal('ReconciliationCard'),
  fact_a_id: z.string().uuid(),
  fact_b_id: z.string().uuid(),
  reason: z.string(), // short label: "reporting period differs", "unit difference", ...
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
});

const ComparisonRow = z.object({
  label: z.string(),
  value: z.string(),
  fact_id: z.string().uuid().optional(),
});
const ComparisonTable = z.object({
  type: z.literal('ComparisonTable'),
  title: z.string().optional(),
  rows: z.array(ComparisonRow).min(1),
});

const TimelineEvent = z.object({
  time_value: z.string(),
  value_display: z.string(),
  fact_id: z.string().uuid().optional(),
});
const Timeline = z.object({
  type: z.literal('Timeline'),
  subject: z.string(),
  events: z.array(TimelineEvent).min(1),
});

const EntityCard = z.object({
  type: z.literal('EntityCard'),
  entity_id: z.string().uuid(),
  name: z.string(),
  entity_type: z.string(),
  fact_count: z.number().int().min(0),
});

const UncertaintyCard = z.object({
  type: z.literal('UncertaintyCard'),
  message: z.string(), // "I cannot confidently determine this."
  reason: z.string(),
});

const RelationshipCard = z.object({
  type: z.literal('RelationshipCard'),
  relationship_id: z.string().uuid().optional(),
  fact_a_id: z.string().uuid(),
  fact_b_id: z.string().uuid(),
  relationship_type: z.string(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
});

const SourcePreview = z.object({
  type: z.literal('SourcePreview'),
  document_id: z.string().uuid(),
  document_filename: z.string(),
  page: z.number().int().positive(),
  quote: z.string(),
  fact_id: z.string().uuid().optional(),
  evidence_id: z.string().uuid().optional(),
});

export const Component = z.discriminatedUnion('type', [
  AnswerText,
  FactCard,
  EvidenceCard,
  CorroborationCard,
  ConflictCard,
  ReconciliationCard,
  ComparisonTable,
  Timeline,
  EntityCard,
  UncertaintyCard,
  RelationshipCard,
  SourcePreview,
]);
export type UIComponent = z.infer<typeof Component>;

export const AnswerPlan = z.object({
  components: z.array(Component).min(1),
});
export type AnswerPlan = z.infer<typeof AnswerPlan>;

/** Never render an unvalidated plan. Falls back to a plain, honest message. */
export function parseAnswerPlan(raw: unknown): AnswerPlan {
  const result = AnswerPlan.safeParse(raw);
  if (result.success) return result.data;
  return {
    components: [
      {
        type: 'UncertaintyCard',
        message: 'I could not produce a well-formed answer for this question.',
        reason: 'The generated response did not match the expected UI schema and was discarded rather than rendered unsafely.',
      },
    ],
  };
}
