export interface SummaryLine { label: string; amount: number }
export interface OrderSummaryProps {
  /** e.g. { label: "GH₵450 × 4 travellers", amount: 1800 } */
  lines: SummaryLine[];
  total: number;
  currency?: "GHS" | "USD";
  /** Approximate USD equivalent of the total. */
  approxTotal?: number;
  discount?: { label: string; amount: number };
  fees?: number;
  /** Drives the closing charge sentence and its icon. */
  payMode?: "later" | "now";
  /** Overrides the default charge sentence. */
  note?: string;
  /** Sticks to the viewport on desktop checkout. */
  sticky?: boolean;
  /** Slot for PromoCode. */
  children?: React.ReactNode;
}
export declare function OrderSummary(props: OrderSummaryProps): JSX.Element;
