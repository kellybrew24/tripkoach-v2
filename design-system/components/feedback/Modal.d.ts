export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  /** "danger" adds the warning mark; pair it with a danger-variant confirm Button. */
  tone?: "default" | "danger";
  children?: React.ReactNode;
  /** Buttons; cancel first in DOM order, confirm last. On mobile they stack with confirm on top. */
  actions?: React.ReactNode;
  onClose?: () => void;
  labelledBy?: string;
}
export declare function Modal(props: ModalProps): JSX.Element | null;
