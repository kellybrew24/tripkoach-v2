/**
 * @startingPoint section="Checkout" subtitle="Multi-step wizard progress" viewport="700x160"
 */
export interface CheckoutStepperProps {
  /** Step labels, e.g. ["Departure","Travellers","Review","Payment","Done"]. */
  steps: string[];
  /** Zero-based index of the active step. */
  current?: number;
  /** Index of a step that failed validation; renders red. */
  errorAt?: number;
  /** Enables backwards navigation to completed steps — data is always preserved. */
  onStepClick?: (index: number) => void;
}
export declare function CheckoutStepper(props: CheckoutStepperProps): JSX.Element;
