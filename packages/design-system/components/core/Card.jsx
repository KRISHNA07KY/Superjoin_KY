import React from 'react';

export function Card({ tag, title, children, footer, interactive, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        position: 'relative', borderRadius: 'var(--r-lg)', padding: 20,
        background: 'var(--surface)', border: '1px solid var(--line)',
        boxShadow: hover ? 'var(--shadow-pop)' : 'var(--shadow-card)',
        display: 'flex', flexDirection: 'column', color: 'var(--ink)',
        transform: hover ? 'translateY(var(--lift-hover-card))' : 'none',
        transition: 'transform var(--dur-base) var(--ease-out-soft), box-shadow var(--dur-base)',
        ...style,
      }}
    >
      {tag && (
        <span style={{
          fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em',
          color: 'var(--muted)', marginBottom: 6,
        }}>{tag}</span>
      )}
      {title && (
        <h3 style={{
          fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-display)',
          fontSize: 'var(--fs-display-card-h3)', letterSpacing: 'var(--tracking-display)',
          color: 'var(--ink)', margin: 0,
        }}>{title}</h3>
      )}
      {children && <div style={{ marginTop: title ? 10 : 0, color: 'var(--ink-2)', fontSize: 14 }}>{children}</div>}
      {footer && <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>{footer}</div>}
    </div>
  );
}
