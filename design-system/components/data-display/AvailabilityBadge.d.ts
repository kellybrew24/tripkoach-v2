export interface AvailabilityBadgeProps {
  /** Remaining seats on a departure. 0 renders "Sold out". */
  spotsLeft: number;
  /** At or below this, urgency wording kicks in. Default 5. */
  threshold?: number;
}
export declare function AvailabilityBadge(props: AvailabilityBadgeProps): JSX.Element;
