export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: React.ReactNode;
  /** Secondary line under the label — policy detail, price impact. */
  description?: React.ReactNode;
  /** Renders as a bordered selectable card (used for filters and add-ons). */
  card?: boolean;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;
