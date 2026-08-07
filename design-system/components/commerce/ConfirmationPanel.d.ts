export interface ConfirmationPanelProps {
  /** Booking reference, e.g. "TK-4821". Shown in a copyable dashed box. */
  reference: string;
  status?: "pending" | "confirmed" | "paid";
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}
export declare function ConfirmationPanel(props: ConfirmationPanelProps): JSX.Element;
