import React from "react";

/* GHS is the currency of record: every amount is stored and charged in Ghana cedis.
   USD is a courtesy conversion and is always marked approximate. */
export const CURRENCIES = {
  GHS: { symbol: "GH₵", code: "GHS", locale: "en-GH" },
  USD: { symbol: "$", code: "USD", locale: "en-US" },
};

export function formatMoney(amount, currency = "GHS", { decimals = 0 } = {}) {
  const c = CURRENCIES[currency] || CURRENCIES.GHS;
  return c.symbol + amount.toLocaleString(c.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function Price({
  amount, currency = "GHS", size = "md", from = false, unit, was,
  approxAmount, approxCurrency = "USD", srPrefix,
}) {
  return (
    <span className={["tk-price", size !== "md" && `tk-price--${size}`].filter(Boolean).join(" ")}>
      <span>
        {from && <span className="tk-price__from" style={{ display: "block" }}>From</span>}
        <span className="tk-price__amount">
          {srPrefix && <span className="tk-sr-only">{srPrefix} </span>}
          {formatMoney(amount, currency)}
          <span className="tk-sr-only"> {CURRENCIES[currency].code}</span>
        </span>
        {approxAmount != null && (
          <span className="tk-price__alt">≈ {formatMoney(approxAmount, approxCurrency)} {approxCurrency}</span>
        )}
      </span>
      {was != null && <span className="tk-price__was">{formatMoney(was, currency)}</span>}
      {unit && <span className="tk-price__unit">{unit}</span>}
    </span>
  );
}
