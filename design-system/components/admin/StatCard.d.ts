export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: string;
  /** Change label, e.g. "+12%". */
  delta?: string;
  deltaDir?: "up" | "down" | "flat";
  /** Trailing context, e.g. "vs last week". Green up is not always good — pair with a clear label. */
  hint?: string;
  loading?: boolean;
}
export declare function StatCard(props: StatCardProps): JSX.Element;
