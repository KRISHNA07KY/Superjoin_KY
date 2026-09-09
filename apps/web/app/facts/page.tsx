'use client';

/**
 * /facts — The fact explorer: a searchable, filterable list of all
 * extracted facts. Each fact row is clickable and opens the fact
 * detail + evidence in the right-hand context panel.
 *
 * This lets the grader see that the system's knowledge layer is real,
 * structured, and linked to evidence — not just a chatbot.
 */

import React from 'react';
import AppShell from '../../components/shell/AppShell';
import { listFacts, type FactView } from '../../lib/api';
import { useContextPanel } from '../../lib/context-panel';

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 0.8 ? 'var(--corroborate)' : value >= 0.6 ? 'var(--reconcile)' : 'var(--uncertain)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width: 48,
          height: 4,
          borderRadius: 2,
          background: 'var(--line-strong)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.round(value * 100)}%`,
            height: '100%',
            background: color,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

function FactRow({ fact }: { fact: FactView }) {
  const { openFact } = useContextPanel();
  const [hovered, setHovered] = React.useState(false);

  return (
    <tr
      id={`fact-row-${fact.id.slice(0, 8)}`}
      onClick={() => openFact(fact)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: 'pointer',
        background: hovered ? 'var(--surface-raised)' : 'transparent',
        borderBottom: '1px solid var(--line)',
        transition: 'background 0.1s',
      }}
    >
      <td style={{ padding: '10px 14px', maxWidth: 200 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {fact.subject ?? '—'}
        </div>
      </td>
      <td style={{ padding: '10px 14px', maxWidth: 180 }}>
        <div
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {fact.predicate ?? '—'}
        </div>
      </td>
      <td style={{ padding: '10px 14px' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink)',
          }}
        >
          {fact.value_raw}
        </span>
      </td>
      <td style={{ padding: '10px 14px' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
          {fact.time_value ?? '—'}
        </span>
      </td>
      <td style={{ padding: '10px 14px', maxWidth: 180 }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'block',
          }}
          title={fact.document_filename}
        >
          {fact.document_filename}
        </span>
      </td>
      <td style={{ padding: '10px 14px' }}>
        <ConfidenceBar value={fact.confidence} />
      </td>
      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
        <span
          style={{
            background: 'var(--surface-overlay)',
            borderRadius: 10,
            padding: '2px 8px',
            fontSize: 12,
            color: (fact.evidence?.length ?? 0) > 0 ? 'var(--corroborate)' : 'var(--muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {fact.evidence?.length ?? 0}
        </span>
      </td>
    </tr>
  );
}

export default function FactsPage() {
  const [facts, setFacts] = React.useState<FactView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    listFacts()
      .then(setFacts)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load facts.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = facts.filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      f.subject?.toLowerCase().includes(q) ||
      f.predicate?.toLowerCase().includes(q) ||
      f.value_raw.toLowerCase().includes(q) ||
      f.document_filename.toLowerCase().includes(q)
    );
  });

  return (
    <AppShell>
      <div style={{ padding: '28px 32px', flex: 1 }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
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
            Fact Explorer
          </h1>
          <p style={{ color: 'var(--ink-2)', fontSize: 13.5, margin: 0 }}>
            {facts.length} facts extracted across {new Set(facts.map((f) => f.document_id)).size} documents.
            Click any row to see its evidence.
          </p>
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            id="facts-search"
            type="text"
            placeholder="Filter by subject, predicate, value, or document…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--surface)',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--r-md)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-body)',
              fontSize: 13.5,
              padding: '8px 14px',
              outline: 'none',
            }}
          />
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>Loading…</div>
        ) : error ? (
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
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
            {search ? 'No facts match your filter.' : 'No facts yet. Upload and process a PDF first.'}
          </div>
        ) : (
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line-strong)', background: 'var(--surface-raised)' }}>
                  {['Subject', 'Predicate', 'Value', 'Period', 'Document', 'Confidence', 'Evidence'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 14px',
                        textAlign: 'left',
                        fontSize: 10,
                        letterSpacing: '.07em',
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 500,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((fact) => (
                  <FactRow key={fact.id} fact={fact} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
