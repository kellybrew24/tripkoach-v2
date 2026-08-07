export interface ToastProps {
  tone?: "info" | "success" | "error";
  children: React.ReactNode;
  onClose?: () => void;
}
export declare function Toast(props: ToastProps): JSX.Element;
