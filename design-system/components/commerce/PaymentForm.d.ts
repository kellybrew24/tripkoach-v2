export interface PaymentFormProps {
  /** "now" hands off to Paystack; "later" holds the booking as Pending. */
  mode?: "now" | "later";
  onModeChange?: (mode: "now" | "later") => void;
  /** Feature flag. Defaults true — Paystack is live. Set false to disable pay-now and show a "Soon" badge. */
  payNowEnabled?: boolean;
  /** Hand-off state. "processing" shows the "Opening Paystack…" spinner; "failed"/"succeeded" show the result banner. */
  state?: "idle" | "processing" | "succeeded" | "failed";
  /** Human deadline copy for pay-later, e.g. "5 days before departure". */
  dueBy?: string;
  /** Amount shown in the hand-off sentence, e.g. "$300". Optional. */
  amountLabel?: string;
}
export declare function PaymentForm(props: PaymentFormProps): JSX.Element;
