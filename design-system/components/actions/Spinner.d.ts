export interface SpinnerProps {
  size?: number;
  /** Announced to screen readers via role="status". */
  label?: string;
  inline?: boolean;
}
export declare function Spinner(props: SpinnerProps): JSX.Element;
