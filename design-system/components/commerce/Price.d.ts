/**
 * @startingPoint section="Commerce" subtitle="GHS / USD price display treatments" viewport="700x220"
 */
export interface PriceProps {
  amount: number;
  /** Currency of record. GHS is what the customer is actually charged. */
  currency?: "GHS" | "USD";
  size?: "sm" | "md" | "lg";
  /** Prefix "From" for a tour's cheapest departure. */
  from?: boolean;
  /** Unit qualifier — always state it: "per person" or "total". */
  unit?: string;
  /** Original price, struck through, when a discount applies. */
  was?: number;
  /** Converted amount, rendered as an approximate USD line beneath. Never the charge amount. */
  approxAmount?: number;
  approxCurrency?: "USD";
  /** Screen-reader-only prefix, e.g. "Total". */
  srPrefix?: string;
}
export declare function Price(props: PriceProps): JSX.Element;
export declare function formatMoney(amount: number, currency?: string, opts?: { decimals?: number }): string;
export declare const CURRENCIES: Record<string, { symbol: string; code: string; locale: string }>;
