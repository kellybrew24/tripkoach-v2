export interface CurrencyToggleProps {
  value?: "GHS" | "USD";
  onChange?: (currency: "GHS" | "USD") => void;
  options?: Array<"GHS" | "USD">;
}
export declare function CurrencyToggle(props: CurrencyToggleProps): JSX.Element;
