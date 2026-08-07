export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Lucide icon rendered inside the leading edge. */
  iconStart?: string;
  /** Node pinned to the trailing edge — a show/hide toggle, unit, or clear button. */
  trailing?: React.ReactNode;
  /** "success" paints a green border after a validated async check. */
  state?: "success";
}
export declare function Input(props: InputProps): JSX.Element;
