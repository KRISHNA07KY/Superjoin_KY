import React from 'react';

const VARIANTS = {
  primary: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
  ghost: { background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line-strong)' },
  outline: { background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' },
  danger: { background: 'transparent', color: 'var(--contradict)', border: '1px solid var(--contradict-border)' },
};

export function Button({ variant = 'primary', size = 'md', icon, children, disabled, onClick, style }) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const [hover, setHover] = React.useState(false);
  const padding = size === 'sm' ? '6px 12px' : size === 'lg' ? '12px 20px' : '9px 16px';
  const fontSize = size === 'sm' ? 13 : size === 'lg' ? 15 : 14;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center',
        fontFamily: 'var(--font-body)', fontWeight: 600, fontSize, padding, borderRadius: 'var(--r-md)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
        whiteSpace: 'nowrap', transition: 'transform var(--dur-fast) var(--ease-out-soft), filter var(--dur-fast)',
        transform: hover && !disabled ? `translateY(var(--lift-hover))` : 'none',
        filter: hover && !disabled ? 'brightness(1.08)' : 'none',
        ...v, ...style,
      }}
    >
      {icon}{children}
    </button>
  );
}
