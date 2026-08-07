import React from "react";
const COLORS = ["var(--chart-1)","var(--chart-2)","var(--chart-3)","var(--chart-4)","var(--chart-5)","var(--chart-6)"];

export function MiniChart({ type = "line", data = [], height = 160, ariaLabel }) {
  const w = 480, h = height, pad = 8;
  if (type === "donut") {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let acc = 0; const r = 54, cx = 70, cy = 70, C = 2 * Math.PI * r;
    return (
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <svg viewBox="0 0 140 140" width={140} height={140} role="img" aria-label={ariaLabel}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--chart-grid)" strokeWidth={18} />
          {data.map((d, i) => { const frac = d.value / total; const dash = frac * C; const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={18} strokeDasharray={dash + " " + (C - dash)} strokeDashoffset={-acc * C} transform={"rotate(-90 " + cx + " " + cy + ")"} />; acc += frac; return el; })}
        </svg>
        <div className="tk-legend" style={{ flexDirection: "column", gap: 8 }}>
          {data.map((d, i) => <span key={i}><i style={{ background: COLORS[i % COLORS.length] }} />{d.label} · <strong style={{ color: "var(--text-strong)" }}>{d.value}</strong></span>)}
        </div>
      </div>
    );
  }
  const max = Math.max(...data.map(d => d.value), 1);
  const stepX = (w - pad * 2) / Math.max(data.length - 1, 1);
  const y = (v) => h - pad - (v / max) * (h - pad * 2 - 14);
  return (
    <div>
      <svg viewBox={"0 0 " + w + " " + h} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
        {[0.25,0.5,0.75,1].map((g,i) => <line key={i} x1={pad} x2={w-pad} y1={pad+ (h-pad*2-14)*g} y2={pad+(h-pad*2-14)*g} stroke="var(--chart-grid)" strokeWidth={1} />)}
        {type === "bar"
          ? data.map((d, i) => { const bw = stepX * 0.55; const x = pad + i * ((w - pad*2)/data.length) + ((w-pad*2)/data.length - bw)/2; return <rect key={i} x={x} y={y(d.value)} width={bw} height={h - pad - y(d.value)} rx={3} fill="var(--chart-1)" />; })
          : <><polyline fill="none" stroke="var(--chart-1)" strokeWidth={2.5} strokeLinejoin="round" points={data.map((d, i) => (pad + i * stepX) + "," + y(d.value)).join(" ")} />
             {data.map((d, i) => <circle key={i} cx={pad + i * stepX} cy={y(d.value)} r={3} fill="var(--surface-card)" stroke="var(--chart-1)" strokeWidth={2} />)}</>}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-subtle)", marginTop: 4 }}>
        {data.map((d, i) => <span key={i}>{d.label}</span>)}
      </div>
    </div>
  );
}
