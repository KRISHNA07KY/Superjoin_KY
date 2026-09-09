import React from 'react';

const TONE = {
  corroborate: { color: 'var(--corroborate)', background: 'var(--corroborate-soft)', border: 'var(--corroborate-border)' },
  contradict: { color: 'var(--contradict)', background: 'var(--contradict-soft)', border: 'var(--contradict-border)' },
  reconcile: { color: 'var(--reconcile)', background: 'var(--reconcile-soft)', border: 'var(--reconcile-border)' },
  uncertain: { color: 'var(--uncertain)', background: 'var(--uncertain-soft)', border: 'var(--uncertain-border)' },
  neutral: { color: 'var(--ink-2)', background: 'var(--surface-raised)', border: 'var(--line)' },
};

/** Small status/relationship indicator — e.g. "Corroborated", "Potential contradiction", "Uncertain". */
export function Badge({ tone = 'neutral', icon, children }) {
  const t = TONE[tone] || TONE.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 'var(--r-pill)',
      fontWeight: 600, fontSize: 12.5, color: t.color, background: t.background, border: `1px solid ${t.border}`,
    }}>
      {icon && <span style={{ width: 12, height: 12, display: 'flex' }}>{icon}</span>}
      {children}
    </span>
  );
}
