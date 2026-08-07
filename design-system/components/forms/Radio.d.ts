export interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  name: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Card styling — the default for payment-mode selection. */
  card?: boolean;
  /** Trailing node, e.g. a Price or badge. */
  trailing?: React.ReactNode;
}
export declare function Radio(props: RadioProps): JSX.Element;
