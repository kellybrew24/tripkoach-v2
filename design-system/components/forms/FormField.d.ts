export interface FormFieldProps {
  /** Must match the control's id — wires label, helper text and error together. */
  id: string;
  label: string;
  /** Show "(optional)". TripKoach marks the optional fields, not the required ones — except where a form is mostly optional. */
  optional?: boolean;
  required?: boolean;
  /** Guidance shown before the user makes a mistake. Sentence case, no full stop. */
  help?: string;
  /** Error message; announced via role="alert" and sets aria-invalid on the control. */
  error?: string;
  /** Positive confirmation, e.g. "Promo code applied". */
  success?: string;
  children: React.ReactNode;
}
export declare function FormField(props: FormFieldProps): JSX.Element;
