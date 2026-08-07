import React from "react";
import { Icon } from "../icons/Icon.jsx";
import { Button } from "../actions/Button.jsx";

export function PromoCode({ state = "idle", code = "", onApply, onRemove, error, discountLabel }) {
  const [open, setOpen] = React.useState(state !== "idle");
  const [val, setVal] = React.useState(code);
  if (state === "applied") {
    return (
      <div className="tk-row" style={{ gap: "var(--space-2)", justifyContent: "space-between", flexWrap: "wrap" }}>
        <span className="tk-badge tk-badge--confirmed"><Icon name="badge-percent" size={13} />{code} applied</span>
        <span className="tk-row" style={{ gap: "var(--space-3)" }}>
          {discountLabel && <span className="tk-body-sm" style={{ color: "var(--success-fg)", fontWeight: 600 }}>{discountLabel}</span>}
          <Button variant="link" size="sm" onClick={onRemove}>Remove</Button>
        </span>
      </div>
    );
  }
  if (!open) return <Button variant="link" size="sm" iconStart="badge-percent" onClick={() => setOpen(true)}>Have a promo code?</Button>;
  return (
    <div className="tk-stack" style={{ gap: "var(--space-2)" }}>
      <label className="tk-label" htmlFor="promo">Promo code</label>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <input id="promo" className="tk-input" value={val} onChange={(e) => setVal(e.target.value.toUpperCase())}
          placeholder="HARMATTAN10" aria-invalid={state === "invalid" || undefined}
          aria-describedby={state === "invalid" ? "promo-err" : undefined} autoCapitalize="characters" />
        <Button variant="secondary" loading={state === "loading"} onClick={() => onApply && onApply(val)}>Apply</Button>
      </div>
      {state === "invalid" && (
        <p className="tk-error" id="promo-err" role="alert"><Icon name="circle-alert" size={14} />{error || "That code is not valid or has expired."}</p>
      )}
    </div>
  );
}
