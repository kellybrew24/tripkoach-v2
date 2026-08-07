export interface EmptyStateProps {
  /** Lucide icon name; default "compass". */
  icon?: string;
  title: string;
  /** One or two sentences that say what to do next, not what went wrong. */
  body?: string;
  /** A Button that resolves the emptiness. */
  action?: React.ReactNode;
}
export declare function EmptyState(props: EmptyStateProps): JSX.Element;
