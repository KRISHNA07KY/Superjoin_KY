export interface BadgeProps {
  /** corroborate = green, contradict = rose, reconcile = amber, uncertain = grey, neutral = default */
  tone?: 'corroborate' | 'contradict' | 'reconcile' | 'uncertain' | 'neutral';
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export function Badge(props: BadgeProps): JSX.Element;
