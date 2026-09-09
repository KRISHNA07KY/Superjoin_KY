/** Generic surface container — the base every FactCard/EvidenceCard/etc. builds on. */
export interface CardProps {
  tag?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Enables hover lift/shadow — off by default for cards embedded in dense lists. */
  interactive?: boolean;
  style?: React.CSSProperties;
}

export function Card(props: CardProps): JSX.Element;
