export interface BannerProps {
  type?: 'error' | 'warning' | 'success' | 'info';
  children?: React.ReactNode;
}

export function Banner(props: BannerProps): JSX.Element;
