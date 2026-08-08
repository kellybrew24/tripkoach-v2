import React from "react";
import { Icon } from "../icons/Icon.jsx";
import { Price } from "./Price.jsx";
import { AvailabilityBadge } from "../data-display/AvailabilityBadge.jsx";

export function DeparturePicker({ departures = [], value, onChange, currency = "GHS", legend = "Choose a departure" }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="tk-label" style={{ marginBottom: "var(--space-3)" }}>{legend}</legend>
      <div className="tk-stack" style={{ gap: "var(--space-2)" }}>
        {departures.map((d) => {
          const sold = d.spotsLeft <= 0;
          return (
            <button key={d.id} type="button" className="tk-departure" disabled={sold}
              data-selected={value === d.id} aria-pressed={value === d.id}
              onClick={() => !sold && onChange && onChange(d.id)}>
              <Icon name="calendar-days" size={20} style={{ color: "var(--text-muted)" }} />
              <span className="tk-stack" style={{ gap: 2 }}>
                <span className="tk-departure__date">{d.date}</span>
                <span className="tk-departure__sub">{d.time}{d.guide ? " · " + d.guide : ""}</span>
              </span>
              <span className="tk-departure__right">
                {d.price != null && <Price amount={d.price} currency={currency} size="sm" unit="pp" />}
                <AvailabilityBadge spotsLeft={d.spotsLeft} />
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
