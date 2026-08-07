import React from "react";
import { Icon } from "../icons/Icon.jsx";
import { StatusBadge } from "../data-display/StatusBadge.jsx";
import { formatMoney } from "./Price.jsx";

export function BookingRow({ reference, title, date, travellers, total, currency = "GHS", status, image, onClick }) {
  return (
    <button type="button" className="tk-bookingrow" onClick={onClick}>
      {image ? <img className="tk-bookingrow__thumb" src={image} alt="" loading="lazy" />
             : <span className="tk-bookingrow__thumb" aria-hidden="true" />}
      <span className="tk-stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
        <span className="tk-row" style={{ gap: "var(--space-2)", justifyContent: "space-between" }}>
          <span className="tk-caption tk-num">{reference}</span>
          <StatusBadge status={status} />
        </span>
        <span className="tk-h5" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span className="tk-caption" style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Icon name="calendar" size={13} />{date}</span>
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Icon name="users" size={13} />{travellers}</span>
          <span className="tk-num" style={{ fontWeight: 600, color: "var(--text-strong)" }}>{formatMoney(total, currency)}</span>
        </span>
      </span>
      <Icon name="chevron-right" size={18} style={{ color: "var(--text-muted)", alignSelf: "center" }} />
    </button>
  );
}
