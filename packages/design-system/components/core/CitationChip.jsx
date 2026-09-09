import React from 'react';

/**
 * Small inline pill for an evidence citation (e.g. "Annual Report · p.47").
 * Rendered inside AnswerText wherever a [n] marker matches a citation, and
 * standalone in fallback source lists. Clicking opens the source in the
 * right-hand context panel — this component only renders the affordance,
 * the click handler decides what "open" means.
 */
export function CitationChip({ label, marker, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, verticalAlign: 'baseline',
        padding: '1px 9px', margin: '0 2px', borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, lineHeight: 1.7,
        color: hover ? '#fff' : 'var(--accent)', background: hover ? 'var(--accent)' : 'var(--accent-soft)',
        border: '1px solid var(--accent-deep)', cursor: 'pointer',
        transition: 'background var(--dur-fast) var(--ease-out-soft), color var(--dur-fast)',
        ...style,
      }}
    >
      {marker && <span style={{ opacity: 0.85 }}>[{marker}]</span>}
      <span style={{ whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </button>
  );
}
