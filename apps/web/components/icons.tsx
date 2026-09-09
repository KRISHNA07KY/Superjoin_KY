/**
 * Minimal stroke-based icon set (Lucide-style: viewBox 24, strokeWidth 2,
 * round caps/joins, currentColor) — used instead of emoji throughout the app.
 * Colorful bitmap emoji read as inconsistent/unpolished against this
 * product's restrained monochrome dark UI; these icons inherit text color.
 */
import React from 'react';

type IconProps = { size?: number; style?: React.CSSProperties };

const base = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

export function ChatIcon({ size = 16, style }: IconProps) {
  return (
    <svg {...base(size)} style={style}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function FlaskIcon({ size = 16, style }: IconProps) {
  return (
    <svg {...base(size)} style={style}>
      <path d="M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3" />
      <path d="M7.5 15h9" />
    </svg>
  );
}

export function BoltIcon({ size = 16, style }: IconProps) {
  return (
    <svg {...base(size)} style={style}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7z" />
    </svg>
  );
}

export function FileIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...base(size)} style={style}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function CalendarIcon({ size = 13, style }: IconProps) {
  return (
    <svg {...base(size)} style={style}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

export function ScopeIcon({ size = 13, style }: IconProps) {
  return (
    <svg {...base(size)} style={style}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function ClockIcon({ size = 15, style }: IconProps) {
  return (
    <svg {...base(size)} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
