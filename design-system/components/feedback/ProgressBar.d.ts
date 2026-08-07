export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Accessible name, e.g. "Checkout progress". */
  label?: string;
}
export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
