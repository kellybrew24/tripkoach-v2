export interface BadgeProps {
  /** Semantic tone. Status tones map 1:1 to booking/payment states. */
  tone?: "neutral" | "pending" | "confirmed" | "cancelled" | "paid" | "failed" | "refunded" | "solid";
  size?: "sm" | "lg";
  /** Leading status dot — colour alone never carries the meaning, the label does. */
  dot?: boolean;
  children: React.ReactNode;
}
export declare function Badge(props: BadgeProps): JSX.Element;
