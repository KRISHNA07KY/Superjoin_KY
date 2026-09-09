/**
 * Compact UI button. No hard drop-shadow or bounce — a 1px lift and brightness
 * shift on hover, matching a research-tool's restrained interaction language.
 */
export interface ButtonProps {
  /** primary = filled accent, ghost = bordered neutral, outline = bordered accent, danger = bordered contradict-red */
  variant?: 'primary' | 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  children?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function Button(props: ButtonProps): JSX.Element;
