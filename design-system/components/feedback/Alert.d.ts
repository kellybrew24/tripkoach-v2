export interface AlertProps {
  tone?: "info" | "success" | "warning" | "error";
  title?: string;
  children: React.ReactNode;
  /** Inline action, usually a link-variant Button ("Pay now", "Retry"). */
  action?: React.ReactNode;
  onDismiss?: () => void;
}
export declare function Alert(props: AlertProps): JSX.Element;
