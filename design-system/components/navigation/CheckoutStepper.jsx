import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function CheckoutStepper({ steps = [], current = 0, errorAt = -1, onStepClick }) {
  return (
    <nav aria-label="Checkout progress">
      <ol className="tk-stepbar" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {steps.map((s, i) => {
          const state = i === errorAt ? "error" : i < current ? "done" : i === current ? "active" : "todo";
          const clickable = state === "done" && onStepClick;
          return (
            <React.Fragment key={s}>
              <li className="tk-stepbar__step" data-state={state}
                aria-current={state === "active" ? "step" : undefined}>
                {clickable ? (
                  <button type="button" onClick={() => onStepClick(i)} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                    <span className="tk-stepbar__dot">{state === "done" ? <Icon name="check" size={14} /> : i + 1}</span>
                    <span className="tk-stepbar__label">{s}</span>
                    <span className="tk-sr-only">, completed. Go back to this step</span>
                  </button>
                ) : (
                  <>
                    <span className="tk-stepbar__dot">{state === "done" ? <Icon name="check" size={14} /> : i + 1}</span>
                    <span className="tk-stepbar__label">{s}</span>
                  </>
                )}
              </li>
              {i < steps.length - 1 && <li className="tk-stepbar__rule" aria-hidden="true" />}
            </React.Fragment>
          );
        })}
      </ol>
      <p className="tk-caption" style={{ marginTop: "var(--space-2)" }} aria-live="polite">
        Step {current + 1} of {steps.length}: {steps[current]}
      </p>
    </nav>
  );
}
