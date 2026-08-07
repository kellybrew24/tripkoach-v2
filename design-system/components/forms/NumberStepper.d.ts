export interface NumberStepperProps {
  id: string;
  value: number;
  min?: number;
  /** Cap at the departure's remaining spots so the user cannot over-book. */
  max?: number;
  onChange?: (value: number) => void;
  /** Noun used in the screen-reader labels, e.g. "Travellers". */
  label?: string;
  disabled?: boolean;
}
export declare function NumberStepper(props: NumberStepperProps): JSX.Element;
