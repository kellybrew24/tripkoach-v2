export interface PromoCodeProps {
  /** idle collapses to a link; loading disables Apply; applied shows the removable chip. */
  state?: "idle" | "open" | "loading" | "applied" | "invalid";
  code?: string;
  onApply?: (code: string) => void;
  onRemove?: () => void;
  error?: string;
  /** e.g. "−GH₵180". */
  discountLabel?: string;
}
export declare function PromoCode(props: PromoCodeProps): JSX.Element;
