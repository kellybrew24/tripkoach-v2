import React from "react";
import { Icon } from "../icons/Icon.jsx";
import { Radio } from "../forms/Radio.jsx";
import { Alert } from "../feedback/Alert.jsx";
import { Spinner } from "../actions/Spinner.jsx";

/* Payments are handled entirely by Paystack. TripKoach never collects, sees or stores
   card details — the customer is handed off to Paystack's secure checkout. So this form
   has no card fields: pay-now is a hosted-redirect hand-off, pay-later holds the booking. */
export function PaymentForm({
  mode = "later", onModeChange, payNowEnabled = true, state = "idle",
  dueBy = "5 days before departure", amountLabel,
}) {
  return (
    <div className="tk-stack" style={{ gap: "var(--space-4)" }}>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="tk-label" style={{ marginBottom: "var(--space-2)" }}>Payment option</legend>
        <div className="tk-stack" style={{ gap: "var(--space-2)" }}>
          <Radio card id="pay-now" name="paymode" label="Pay now" checked={mode === "now"}
            disabled={!payNowEnabled} onChange={() => onModeChange && onModeChange("now")}
            description={payNowEnabled ? "Secure checkout by Paystack — card, bank or mobile money." : "Card payment is coming soon."}
            trailing={payNowEnabled ? <Icon name="shield-check" size={18} style={{ color: "var(--success-fg)" }} /> : <span className="tk-badge tk-badge--neutral">Soon</span>} />
          <Radio card id="pay-later" name="paymode" label="Pay later" checked={mode === "later"}
            onChange={() => onModeChange && onModeChange("later")}
            description={"Reserve your spots now and pay " + dueBy + ". We'll send payment instructions by email."} />
        </div>
      </fieldset>

      {mode === "later" && (
        <Alert tone="info" title="Nothing is charged today">
          Your booking is held as <strong>Pending</strong>. We'll email payment instructions and remind you before the deadline.
        </Alert>
      )}

      {mode === "now" && state === "failed" && (
        <Alert tone="error" title="Payment wasn't completed">
          Your payment didn't go through at Paystack. Nothing was charged and your spots are still held — try again, or switch to pay later.
        </Alert>
      )}

      {mode === "now" && state === "succeeded" && (
        <Alert tone="success" title="Payment received">Paystack confirmed your payment. Your booking is confirmed.</Alert>
      )}

      {mode === "now" && (state === "idle" || state === "processing") && (
        <div className="tk-card" style={{ borderColor: "var(--border-default)" }}>
          <div className="tk-card__body" style={{ padding: "var(--space-5)", gap: "var(--space-4)" }}>
            <div className="tk-row" style={{ justifyContent: "space-between", gap: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, color: "var(--text-strong)" }}>
                <Icon name="lock" size={16} style={{ color: "var(--success-fg)" }} /> Secured by Paystack
              </span>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {["Visa", "Mastercard", "Verve"].map(m => <span key={m} style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", border: "1px solid var(--border-subtle)", borderRadius: 5, padding: "2px 6px" }}>{m}</span>)}
              </span>
            </div>
            <p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: 0 }}>
              When you {amountLabel ? "pay " + amountLabel : "continue"}, we'll open <strong>Paystack's secure checkout</strong> to finish payment by card, bank transfer or mobile money (MTN, Telecel, AirtelTigo). You'll come straight back here once it's done.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--bg-subtle)", borderRadius: "var(--radius-md)" }}>
              <Icon name="shield-check" size={16} style={{ color: "var(--success-fg)", flex: "none" }} />
              <span className="tk-caption" style={{ margin: 0 }}>TripKoach never sees or stores your card details — Paystack handles them. You’ll only ever pay on Paystack’s secured page; we never ask for card details, PIN or one-time codes by email, phone or text.</span>
            </div>
            {state === "processing" && (
              <div className="tk-row" style={{ gap: 10, color: "var(--text-muted)" }} role="status">
                <Spinner inline /> <span className="tk-body-sm">Opening Paystack…</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
