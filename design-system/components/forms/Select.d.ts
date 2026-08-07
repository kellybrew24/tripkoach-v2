export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  /** Renders a non-value first option. Never use it as the label. */
  placeholder?: string;
}
export declare function Select(props: SelectProps): JSX.Element;
