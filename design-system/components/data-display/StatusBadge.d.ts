/**
 * @startingPoint section="Status" subtitle="Booking and payment status badges" viewport="700x160"
 */
export interface StatusBadgeProps {
  /** Booking status (pending/confirmed/cancelled) or payment status (paid/failed/refunded). */
  status: "pending" | "confirmed" | "cancelled" | "paid" | "failed" | "refunded";
  size?: "sm" | "lg";
  /** Appends the plain-language explanation next to the badge. */
  withHint?: boolean;
}
export declare function StatusBadge(props: StatusBadgeProps): JSX.Element;
