'use client';

/**
 * Generative UI component registry.
 *
 * Each component matches a type in packages/ui-schema/answerPlan.ts.
 * The renderer (AnswerRenderer) takes a validated AnswerPlan and dispatches
 * to the correct component. Unknown types are silently skipped.
 *
 * Design principles:
 * - Citation chips navigate the context panel to the source PDF page.
 * - FactCard / EvidenceCard let you click through to the full evidence.
 * - ConflictCard / CorroborationCard / ReconciliationCard use the semantic
 *   relationship colors from the design tokens.
 * - Nothing renders raw model output — only validated, typed data.
 */

import React from 'react';
import { parseAnswerPlan, type UIComponent, type Citation as CitationType } from '@groundwork/ui-schema/answerPlan';
import { CitationChip as DesignCitationChip } from '@groundwork/design-system/components/core/CitationChip.jsx';
import { useContextPanel } from '../../lib/context-panel';
import { getFact } from '../../lib/api';
import { CalendarIcon, ScopeIcon } from '../icons';

// ---- Shared primitives ----

const mono = (s: string | number | null | undefined, fallback = '—') =>
  s != null && s !== '' ? (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{s}</span>
  ) : (
    <span style={{ color: 'var(--muted)' }}>{fallback}</span>
  );

function Card({
  children,
  accent,
  style: extraStyle,
}: {
  children: React.ReactNode;
  accent?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `1px solid ${accent ?? 'var(--line)'}`,
        borderRadius: 'var(--r-lg)',
        padding: '14px 16px',
        marginBottom: 10,
        borderLeftWidth: accent ? 3 : 1,
        borderLeftColor: accent,
        ...extraStyle,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children, style: extraStyle }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        fontFamily: 'var(--font-mono)',
        marginBottom: 6,
        ...extraStyle,
      }}
    >
      {children}
    </div>
  );
}

function ConfidencePip({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? 'var(--corroborate)' : value >= 0.6 ? 'var(--reconcile)' : 'var(--uncertain)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {pct}%
    </span>
  );
}

// ---- Citation chip ----
// Thin wrapper around the shared design-system CitationChip, wiring its
// click handler to this app's context panel (open the source PDF page).
function CitationChip({ marker, documentId, page, label }: {
  marker: string;
  documentId?: string | null;
  page?: number | null;
  label: string;
}) {
  const { openDocument } = useContextPanel();
  // A citation can legitimately point at a relationship rather than a single
  // page of evidence (e.g. "these two facts contradict each other") — it
  // still renders as a marker, it just isn't clickable-to-a-page.
  const clickable = Boolean(documentId && page);
  return (
    <DesignCitationChip
      marker={marker.replace(/[[\]]/g, '')}
      label={label}
      onClick={clickable ? () => openDocument(documentId as string, label, page as number, label) : undefined}
      style={{ verticalAlign: 'super', fontSize: 11, cursor: clickable ? 'pointer' : 'default', opacity: clickable ? 1 : 0.75 }}
    />
  );
}

// ---- AnswerText ----
function AnswerTextComponent({ c }: { c: Extract<UIComponent, { type: 'AnswerText' }> }) {
  // Replace [n] markers in text with clickable chips
  const citationMap = new Map<string, CitationType>(c.citations.map((cit: CitationType) => [cit.marker, cit]));
  const parts = c.text.split(/(\[\d+\])/g);

  return (
    <div style={{ lineHeight: 1.7, fontSize: 15, color: 'var(--ink)', marginBottom: 12 }}>
      {parts.map((part: string, i: number) => {
        const cit = citationMap.get(part);
        if (cit) {
          return (
            <CitationChip
              key={i}
              marker={part}
              documentId={cit.document_id}
              page={cit.page}
              label={cit.label || (cit.page ? `Document · p.${cit.page}` : 'Related')}
            />
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </div>
  );
}

// ---- FactCard ----
function FactCardComponent({ c }: { c: Extract<UIComponent, { type: 'FactCard' }> }) {
  const { openFact } = useContextPanel();

  async function handleClick() {
    try {
      const factView = await getFact(c.fact_id);
      openFact(factView);
    } catch {
      // If API is unavailable, just show what we have
    }
  }

  return (
    <Card accent="var(--accent)">
      <Label>Fact · {c.source_count > 1 ? `${c.source_count} sources` : '1 source'}</Label>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>
        {c.subject} · {c.predicate}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--ink)',
          marginBottom: 6,
        }}
      >
        {c.value_display}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {c.time_value && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
            <CalendarIcon size={12} style={{ color: 'var(--muted)' }} /> {c.time_value}
          </span>
        )}
        {c.scope && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
            <ScopeIcon size={12} style={{ color: 'var(--muted)' }} /> {c.scope}
          </span>
        )}
        <ConfidencePip value={c.confidence} />
        <button
          id={`fact-card-${c.fact_id.slice(0, 8)}`}
          onClick={handleClick}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            cursor: 'pointer',
            padding: '3px 8px',
          }}
        >
          View evidence →
        </button>
      </div>
    </Card>
  );
}

// ---- EvidenceCard ----
function EvidenceCardComponent({ c }: { c: Extract<UIComponent, { type: 'EvidenceCard' }> }) {
  const { openDocument } = useContextPanel();
  return (
    <Card>
      <Label>Evidence · {c.document_filename} · p.{c.page}</Label>
      <blockquote
        style={{
          margin: '4px 0 8px',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          color: 'var(--ink-2)',
          borderLeft: '3px solid var(--accent)',
          paddingLeft: 10,
          fontStyle: 'italic',
          lineHeight: 1.5,
        }}
      >
        "{c.quote}"
      </blockquote>
      <button
        id={`evidence-open-${c.evidence_id?.slice(0, 8) ?? c.document_id.slice(0, 8)}`}
        onClick={() => openDocument(c.document_id, c.document_filename, c.page, `${c.document_filename} · p.${c.page}`)}
        style={{
          background: 'none',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)',
          color: 'var(--accent)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          cursor: 'pointer',
          padding: '3px 8px',
        }}
      >
        Open source →
      </button>
    </Card>
  );
}

// ---- CorroborationCard ----
function CorroborationCardComponent({ c }: { c: Extract<UIComponent, { type: 'CorroborationCard' }> }) {
  return (
    <Card accent="var(--corroborate)">
      <Label>✓ Corroboration · {c.fact_ids.length} facts agree</Label>
      <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 8 }}>
        {c.explanation}
      </div>
      <ConfidencePip value={c.confidence} />
    </Card>
  );
}

// ---- ConflictCard ----
function ConflictCardComponent({ c }: { c: Extract<UIComponent, { type: 'ConflictCard' }> }) {
  const isPotential = c.relationship_type === 'POTENTIAL_CONTRADICTION';
  return (
    <Card accent="var(--contradict)">
      <Label style={{ color: 'var(--contradict)' } as React.CSSProperties}>
        {isPotential ? '⚠ Potential Conflict' : '✗ Contradiction'}
      </Label>
      <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 8 }}>
        {c.explanation}
      </div>
      <ConfidencePip value={c.confidence} />
    </Card>
  );
}

// ---- ReconciliationCard ----
function ReconciliationCardComponent({ c }: { c: Extract<UIComponent, { type: 'ReconciliationCard' }> }) {
  return (
    <Card accent="var(--reconcile)">
      <Label style={{ color: 'var(--reconcile)' } as React.CSSProperties}>
        ↔ Reconciled · {c.reason}
      </Label>
      <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 8 }}>
        {c.explanation}
      </div>
      <ConfidencePip value={c.confidence} />
    </Card>
  );
}

// ---- ComparisonTable ----
function ComparisonTableComponent({ c }: { c: Extract<UIComponent, { type: 'ComparisonTable' }> }) {
  return (
    <Card>
      {c.title && <Label>{c.title}</Label>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {c.rows.map((row: { label: string; value: string; fact_id?: string }, i: number) => (
            <tr
              key={i}
              style={{
                borderBottom: i < c.rows.length - 1 ? '1px solid var(--line)' : undefined,
              }}
            >
              <td style={{ padding: '6px 0', color: 'var(--ink-2)', width: '45%' }}>{row.label}</td>
              <td style={{ padding: '6px 0', fontFamily: 'var(--font-mono)', color: 'var(--ink)', fontWeight: 500 }}>
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ---- Timeline ----
function TimelineComponent({ c }: { c: Extract<UIComponent, { type: 'Timeline' }> }) {
  return (
    <Card>
      <Label>Timeline · {c.subject}</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {c.events.map((ev: { time_value: string; value_display: string; fact_id?: string }, i: number) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'baseline',
              borderBottom: i < c.events.length - 1 ? '1px solid var(--line)' : undefined,
              paddingBottom: 6,
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', minWidth: 80 }}>
              {ev.time_value}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
              {ev.value_display}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---- EntityCard ----
function EntityCardComponent({ c }: { c: Extract<UIComponent, { type: 'EntityCard' }> }) {
  return (
    <Card>
      <Label>{c.entity_type}</Label>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{c.name}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
        {c.fact_count} facts extracted
      </div>
    </Card>
  );
}

// ---- UncertaintyCard ----
function UncertaintyCardComponent({ c }: { c: Extract<UIComponent, { type: 'UncertaintyCard' }> }) {
  return (
    <Card accent="var(--uncertain)">
      <Label style={{ color: 'var(--uncertain)' } as React.CSSProperties}>? Uncertain</Label>
      <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>{c.message}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.reason}</div>
    </Card>
  );
}

// ---- RelationshipCard ----
function RelationshipCardComponent({ c }: { c: Extract<UIComponent, { type: 'RelationshipCard' }> }) {
  const colorMap: Record<string, string> = {
    CORROBORATES: 'var(--corroborate)',
    CONTRADICTS: 'var(--contradict)',
    POTENTIAL_CONTRADICTION: 'var(--contradict)',
    RECONCILES: 'var(--reconcile)',
    TEMPORAL_UPDATE: 'var(--accent)',
    UNIT_DIFFERENCE: 'var(--accent)',
    SCOPE_DIFFERENCE: 'var(--accent)',
    UNCERTAIN: 'var(--uncertain)',
  };
  const color = colorMap[c.relationship_type] ?? 'var(--muted)';
  return (
    <Card accent={color}>
      <Label style={{ color } as React.CSSProperties}>
        {c.relationship_type.replace(/_/g, ' ')}
      </Label>
      <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 6 }}>
        {c.explanation}
      </div>
      <ConfidencePip value={c.confidence} />
    </Card>
  );
}

// ---- SourcePreview ----
function SourcePreviewComponent({ c }: { c: Extract<UIComponent, { type: 'SourcePreview' }> }) {
  const { openDocument } = useContextPanel();
  return (
    <Card>
      <Label>Source · {c.document_filename} · p.{c.page}</Label>
      <blockquote
        style={{
          margin: '4px 0 8px',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--ink-2)',
          borderLeft: '3px solid var(--line-strong)',
          paddingLeft: 10,
          fontStyle: 'italic',
          lineHeight: 1.5,
        }}
      >
        "{c.quote}"
      </blockquote>
      <button
        id={`src-preview-${c.document_id.slice(0, 8)}-p${c.page}`}
        onClick={() => openDocument(c.document_id, c.document_filename, c.page)}
        style={{
          background: 'none',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)',
          color: 'var(--accent)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          cursor: 'pointer',
          padding: '3px 8px',
        }}
      >
        Open source →
      </button>
    </Card>
  );
}

// ---- Dispatch ----
function ComponentRenderer({ c }: { c: UIComponent }) {
  switch (c.type) {
    case 'AnswerText': return <AnswerTextComponent c={c} />;
    case 'FactCard': return <FactCardComponent c={c} />;
    case 'EvidenceCard': return <EvidenceCardComponent c={c} />;
    case 'CorroborationCard': return <CorroborationCardComponent c={c} />;
    case 'ConflictCard': return <ConflictCardComponent c={c} />;
    case 'ReconciliationCard': return <ReconciliationCardComponent c={c} />;
    case 'ComparisonTable': return <ComparisonTableComponent c={c} />;
    case 'Timeline': return <TimelineComponent c={c} />;
    case 'EntityCard': return <EntityCardComponent c={c} />;
    case 'UncertaintyCard': return <UncertaintyCardComponent c={c} />;
    case 'RelationshipCard': return <RelationshipCardComponent c={c} />;
    case 'SourcePreview': return <SourcePreviewComponent c={c} />;
    default: return null;
  }
}

// ---- Main export ----
export function AnswerRenderer({ raw }: { raw: unknown }) {
  const plan = parseAnswerPlan(raw);
  return (
    <div style={{ width: '100%' }}>
      {plan.components.map((c: UIComponent, i: number) => (
        <ComponentRenderer key={i} c={c} />
      ))}
    </div>
  );
}
