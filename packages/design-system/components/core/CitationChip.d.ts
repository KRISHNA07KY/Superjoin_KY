/** Small clickable pill for an inline evidence citation, e.g. "Annual Report · p.47". */
export interface CitationChipProps {
  /** Human-readable source label, e.g. "Annual Report · p.47". */
  label: string;
  /** Optional marker token shown as "[n]", e.g. "1". */
  marker?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function CitationChip(props: CitationChipProps): JSX.Element;
