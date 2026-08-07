export interface AuditEvent {
  type: "created" | "confirmed" | "cancelled" | "paid" | "refunded" | "email" | "note" | "failed";
  /** Supports inline <strong>; keep it short and factual. */
  text: string;
  actor?: string;
  time: string;
  /** Semantic tone for the dot: success | warning | danger | info. */
  tone?: "success" | "warning" | "danger" | "info";
}
export interface AuditTimelineProps { events: AuditEvent[] }
export declare function AuditTimeline(props: AuditTimelineProps): JSX.Element;
