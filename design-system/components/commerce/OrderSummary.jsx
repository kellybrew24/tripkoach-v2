import React from "react";
import { Icon } from "../icons/Icon.jsx";
import { formatMoney } from "./Price.jsx";

export function OrderSummary({
  lines = [], total, currency = "GHS", approxTotal, discount, fees, payMode = "later", note, sticky = false, children,
}) {
  return (
    <section className="tk-summary" aria-label="Price summary"
      style={sticky ? { position: "sticky", top: "calc(var(--header-h) + var(--space-4))" } : undefined}>
      <h3 className="tk-h6">Price summary</h3>
      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {lines.map((l) => (
          <div className="tk-summary__line" key={l.label}>
            <dt>{l.label}</dt><dd style={{ margin: 0 }}>{formatMoney(l.amount, currency)}</dd>
          </div>
        ))}
        {fees != null && (
          <div className="tk-summary__line"><dt>Booking fee</dt><dd style={{ margin: 0 }}>{formatMoney(fees, currency)}</dd></div>
        )}
        {discount && (
          <div className="tk-summary__line tk-summary__line--discount">
            <dt>{discount.label}</dt><dd style={{ margin: 0 }}>−{formatMoney(discount.amount, currency)}</dd>
          </div>
        )}
        <div className="tk-summary__total">
          <dt>{payMode === "later" ? "Total due" : "Total"}</dt>
          <dd style={{ margin: 0, textAlign: "end" }}>
            <span className="tk-price__amount tk-num">{formatMoney(total, currency)}</span>
            {approxTotal != null && <span className="tk-price__alt">≈ {formatMoney(approxTotal, "USD")} USD</span>}
          </dd>
        </div>
      </dl>
      {children}
      <p className="tk-caption" style={{ display: "flex", gap: 6 }}>
        <Icon name={payMode === "later" ? "wallet" : "credit-card"} size={14} style={{ marginTop: 2 }} />
        {note || (payMode === "later"
          ? "You will be charged " + formatMoney(total, currency) + " when you pay. Nothing is taken today."
          : "You will be charged " + formatMoney(total, currency) + " now.")}
      </p>
    </section>
  );
}
