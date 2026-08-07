import React from "react";

/* Country dial codes. flag = 2-letter code shown as a small mono badge (no emoji,
   for consistent rendering on low-end Android). Ordered by likely use for a Ghana
   tour operator, then alphabetical. */
export const DIAL_CODES = [
  { code: "GH", dial: "+233", name: "Ghana" },
  { code: "NG", dial: "+234", name: "Nigeria" },
  { code: "US", dial: "+1", name: "United States" },
  { code: "GB", dial: "+44", name: "United Kingdom" },
  { code: "CA", dial: "+1", name: "Canada" },
  { code: "DE", dial: "+49", name: "Germany" },
  { code: "FR", dial: "+33", name: "France" },
  { code: "NL", dial: "+31", name: "Netherlands" },
  { code: "ZA", dial: "+27", name: "South Africa" },
  { code: "KE", dial: "+254", name: "Kenya" },
  { code: "CI", dial: "+225", name: "Côte d'Ivoire" },
  { code: "TG", dial: "+228", name: "Togo" },
  { code: "AU", dial: "+61", name: "Australia" },
  { code: "AE", dial: "+971", name: "United Arab Emirates" },
];

export function PhoneInput({ id, country = "GH", onCountryChange, dialCode, flag, ...rest }) {
  // Backwards-compatible: legacy dialCode/flag props still win if passed.
  const initial = flag || country;
  const [sel, setSel] = React.useState(initial);
  const entry = DIAL_CODES.find(d => d.code === sel) || DIAL_CODES[0];
  const dial = dialCode || entry.dial;
  const change = (e) => { setSel(e.target.value); onCountryChange && onCountryChange(e.target.value); };
  return (
    <div style={{ display: "flex" }}>
      <span className="tk-prefix" style={{ position: "relative", paddingInlineEnd: 2 }}>
        <span aria-hidden="true" style={{ fontSize: "var(--text-caption-size)", fontWeight: 700, letterSpacing: ".04em" }}>{entry.code}</span>
        <span className="tk-num">{dial}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .5 }}><path d="m6 9 6 6 6-6" /></svg>
        <select aria-label="Country dialling code" value={sel} onChange={change}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}>
          {DIAL_CODES.map(d => <option key={d.code + d.dial} value={d.code}>{d.name} ({d.dial})</option>)}
        </select>
      </span>
      <input id={id} className="tk-input" type="tel" inputMode="tel" autoComplete="tel-national"
        placeholder="24 123 4567" aria-describedby={`${id}-cc`} {...rest} />
      <span className="tk-sr-only" id={`${id}-cc`}>Country {entry.name}, dialling code {dial}</span>
    </div>
  );
}
