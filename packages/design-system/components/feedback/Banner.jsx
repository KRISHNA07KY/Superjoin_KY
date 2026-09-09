import React from 'react';

const TONE = {
  error: { background: 'var(--danger-bg)', border: 'var(--danger-border)', color: 'var(--danger)' },
  warning: { background: 'var(--warning-bg)', border: 'var(--warning-border)', color: 'var(--warning-text)' },
  success: { background: 'var(--success-bg)', border: 'var(--success-border)', color: 'var(--success)' },
  info: { background: 'var(--accent-soft)', border: 'var(--accent-deep)', color: 'var(--accent)' },
};

/** Inline status strip — used for uncertainty/failure disclosures ("I cannot confidently determine this"). */
export function Banner({ type = 'info', children }) {
  const t = TONE[type] || TONE.info;
  return (
    <div role="status" style={{
      padding: '10px 14px', borderRadius: 'var(--r-md)', fontWeight: 500, fontSize: 13.5,
      background: t.background, border: `1px solid ${t.border}`, color: t.color, lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}
