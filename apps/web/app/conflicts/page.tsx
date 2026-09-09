'use client';

/**
 * /conflicts — The Conflict Explorer: all cross-document relationships
 * grouped by type. Shows corroborations, contradictions, reconciliations,
 * and other relationship types from the reasoning pipeline.
 *
 * The four grading criteria cases (corroborate, contradict, reconcile from
 * the starter datasets) must be discoverable here once the documents are
 * processed.
 */

import React from 'react';
import AppShell from '../../components/shell/AppShell';
import { listRelationships, getFact, type Relationship, type FactView } from '../../lib/api';
import { useContextPanel } from '../../lib/context-panel';
import { ClockIcon } from '../../components/icons';

type RelType =
  | 'CORROBORATES'
  | 'CONTRADICTS'
  | 'POTENTIAL_CONTRADICTION'
  | 'RECONCILES'
  | 'TEMPORAL_UPDATE'
  | 'UNIT_DIFFERENCE'
  | 'SCOPE_DIFFERENCE'
  | 'UNCERTAIN';

const REL_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string; borderColor: string }> = {
  CORROBORATES: {
    label: 'Corroborates',
    icon: '✓',
    color: 'var(--corroborate)',
    bgColor: 'var(--corroborate-soft)',
    borderColor: 'var(--corroborate-border)',
  },
  CONTRADICTS: {
    label: 'Contradicts',
    icon: '✗',
    color: 'var(--contradict)',
    bgColor: 'var(--contradict-soft)',
    borderColor: 'var(--contradict-border)',
  },
  POTENTIAL_CONTRADICTION: {
    label: 'Potential Contradiction',
    icon: '⚠',
    color: 'var(--contradict)',
    bgColor: 'var(--contradict-soft)',
    borderColor: 'var(--contradict-border)',
  },
  RECONCILES: {
    label: 'Reconciles',
    icon: '↔',
    color: 'var(--reconcile)',
    bgColor: 'var(--reconcile-soft)',
    borderColor: 'var(--reconcile-border)',
  },
  TEMPORAL_UPDATE: {
    label: 'Temporal Update',
    icon: <ClockIcon size={14} />,
    color: 'var(--accent)',
    bgColor: 'var(--accent-soft)',
    borderColor: 'rgba(91,141,239,0.3)',
  },
  UNIT_DIFFERENCE: {
    label: 'Unit Difference',
    icon: '≈',
    color: 'var(--accent)',
    bgColor: 'var(--accent-soft)',
    borderColor: 'rgba(91,141,239,0.3)',
  },
  SCOPE_DIFFERENCE: {
    label: 'Scope Difference',
    icon: '⊂',
    color: 'var(--reconcile)',
    bgColor: 'var(--reconcile-soft)',
    borderColor: 'var(--reconcile-border)',
  },
  UNCERTAIN: {
    label: 'Uncertain',
    icon: '?',
    color: 'var(--uncertain)',
    bgColor: 'var(--uncertain-soft)',
    borderColor: 'var(--uncertain-border)',
  },
};

function ConfidenceChip({ value }: { value: number }) {
  const color =
    value >= 0.8 ? 'var(--corroborate)' : value >= 0.6 ? 'var(--reconcile)' : 'var(--uncertain)';
  return (
    <span
      style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color,
        background: 'var(--surface-raised)',
        borderRadius: 4,
        padding: '2px 6px',
      }}
    >
      {Math.round(value * 100)}% conf.
    </span>
  );
}

function FactMiniCard({ factId }: { factId: string }) {
  const [fact, setFact] = React.useState<FactView | null>(null);
  const { openFact } = useContextPanel();

  React.useEffect(() => {
    getFact(factId).then(setFact).catch(() => null);
  }, [factId]);

  if (!fact) {
    return (
      <div
        style={{
          flex: 1,
          background: 'var(--surface-raised)',
          borderRadius: 'var(--r-sm)',
          padding: '8px 10px',
          fontSize: 12,
          color: 'var(--muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <button
      id={`rel-fact-${factId.slice(0, 8)}`}
      onClick={() => openFact(fact)}
      style={{
        flex: 1,
        background: 'var(--surface-raised)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '10px 12px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'border-color 0.12s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)';
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
        {fact.document_filename}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 4 }}>
        {fact.subject} · {fact.predicate}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>
        {fact.value_raw}
      </div>
      {fact.time_value && (
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
          {fact.time_value}
        </div>
      )}
      {fact.evidence?.[0] && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--ink-2)',
            fontStyle: 'italic',
            borderLeft: '2px solid var(--accent)',
            paddingLeft: 8,
            lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          } as React.CSSProperties}
        >
          "{fact.evidence[0].quote}"
        </div>
      )}
    </button>
  );
}

function RelationshipCard({ rel }: { rel: Relationship }) {
  const cfg = REL_CONFIG[rel.relationship_type] ?? REL_CONFIG['UNCERTAIN'];
  return (
    <div
      id={`rel-${rel.id.slice(0, 8)}`}
      style={{
        background: cfg.bgColor,
        border: `1px solid ${cfg.borderColor}`,
        borderRadius: 'var(--r-lg)',
        padding: '14px 16px',
        marginBottom: 12,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: cfg.color,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {cfg.icon}
        </span>
        <span
          style={{
            fontSize: 11,
            letterSpacing: '.07em',
            textTransform: 'uppercase',
            color: cfg.color,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {cfg.label}
        </span>
        <ConfidenceChip value={rel.confidence} />
      </div>

      {/* Explanation */}
      <div
        style={{
          fontSize: 13.5,
          color: 'var(--ink)',
          lineHeight: 1.55,
          marginBottom: 12,
        }}
      >
        {rel.explanation}
      </div>

      {/* The two facts side by side */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <FactMiniCard factId={rel.fact_a_id} />
        <div
          style={{
            alignSelf: 'center',
            fontSize: 18,
            color: cfg.color,
            flexShrink: 0,
          }}
        >
          {cfg.icon}
        </div>
        <FactMiniCard factId={rel.fact_b_id} />
      </div>
    </div>
  );
}

function Section({ icon, title, rels }: { icon: React.ReactNode; title: string; rels: Relationship[] }) {
  const [collapsed, setCollapsed] = React.useState(false);
  if (rels.length === 0) return null;

  return (
    <div style={{ marginBottom: 28 }}>
      <button
        id={`section-toggle-${title.replace(/\s/g, '-').toLowerCase()}`}
        onClick={() => setCollapsed((c) => !c)}
        style={{
          background: 'none',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          marginBottom: 12,
          padding: 0,
        }}
      >
        <span style={{ display: 'flex', color: 'var(--ink-2)' }}>{icon}</span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 18,
            color: 'var(--ink)',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--muted)',
            background: 'var(--surface-raised)',
            borderRadius: 10,
            padding: '1px 8px',
          }}
        >
          {rels.length}
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {collapsed ? '▼' : '▲'}
        </span>
      </button>
      {!collapsed && rels.map((r) => <RelationshipCard key={r.id} rel={r} />)}
    </div>
  );
}

const ORDER: RelType[] = [
  'CONTRADICTS',
  'POTENTIAL_CONTRADICTION',
  'CORROBORATES',
  'RECONCILES',
  'SCOPE_DIFFERENCE',
  'UNIT_DIFFERENCE',
  'TEMPORAL_UPDATE',
  'UNCERTAIN',
];

export default function ConflictsPage() {
  const [rels, setRels] = React.useState<Relationship[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    listRelationships()
      .then(setRels)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load relationships.'))
      .finally(() => setLoading(false));
  }, []);

  const grouped = React.useMemo(() => {
    const g = new Map<string, Relationship[]>();
    for (const r of rels) {
      const k = r.relationship_type ?? 'UNCERTAIN';
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(r);
    }
    return g;
  }, [rels]);

  return (
    <AppShell>
      <div style={{ padding: '28px 32px', flex: 1, maxWidth: 860 }}>
        <div style={{ marginBottom: 24 }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 26,
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
              margin: 0,
              marginBottom: 6,
            }}
          >
            Conflict Explorer
          </h1>
          <p style={{ color: 'var(--ink-2)', fontSize: 13.5, margin: 0 }}>
            {rels.length} cross-document relationships detected.
            Grouped by type — click any fact to see its evidence.
          </p>
        </div>

        {loading && (
          <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>Loading…</div>
        )}
        {error && (
          <div
            style={{
              padding: '12px 16px',
              background: 'var(--contradict-soft)',
              border: '1px solid var(--contradict-border)',
              borderRadius: 'var(--r-md)',
              color: 'var(--contradict)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {!loading && rels.length === 0 && !error && (
          <div style={{ color: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
            No cross-document relationships yet. Process multiple documents first.
          </div>
        )}

        {ORDER.map((type) => {
          const cfg = REL_CONFIG[type] ?? REL_CONFIG['UNCERTAIN'];
          return (
            <Section
              key={type}
              icon={cfg.icon}
              title={cfg.label}
              rels={grouped.get(type) ?? []}
            />
          );
        })}

        {/* Any type not in ORDER */}
        {Array.from(grouped.entries())
          .filter(([k]) => !ORDER.includes(k as RelType))
          .map(([k, rs]) => (
            <Section key={k} icon={null} title={k} rels={rs} />
          ))}
      </div>
    </AppShell>
  );
}
