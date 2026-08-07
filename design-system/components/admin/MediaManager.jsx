import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function MediaManager({ items = [], coverId, onSetCover, onRemove, onReorder, onUpload }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label className="tk-dropzone">
        <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => onUpload && onUpload(e.target.files)} />
        <Icon name="download" size={22} style={{ transform: "rotate(180deg)" }} />
        <div style={{ marginTop: 6, fontWeight: 600, color: "var(--text-body)" }}>Drop images here or click to upload</div>
        <div style={{ fontSize: 12.5 }}>JPG or WebP, up to 5MB each. First image is the cover.</div>
      </label>
      {items.length > 0 && (
        <div className="tk-media-grid">
          {items.map((m, i) => (
            <figure className="tk-media-tile" key={m.id} style={{ margin: 0 }}>
              <img src={m.src} alt={m.alt || ""} />
              {coverId === m.id && <span className="tk-media-tile__cover">Cover</span>}
              {m.progress != null && m.progress < 100 && (
                <span style={{ position: "absolute", inset: 0, background: "rgba(20,19,18,.55)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: 13 }}>{m.progress}%</span>
              )}
              {m.error && <span style={{ position: "absolute", inset: 0, background: "var(--danger-bg)", display: "grid", placeItems: "center", color: "var(--danger-fg)", fontSize: 12, textAlign: "center", padding: 8 }}>Upload failed — retry</span>}
              <div className="tk-media-tile__bar">
                <button type="button" className="tk-iconbtn-plain" style={{ width: 30, height: 30, color: "#fff" }} aria-label="Move left" disabled={i === 0} onClick={() => onReorder && onReorder(i, i - 1)}><Icon name="chevron-left" size={16} /></button>
                <button type="button" className="tk-iconbtn-plain" style={{ width: 30, height: 30, color: "#fff" }} aria-label="Move right" disabled={i === items.length - 1} onClick={() => onReorder && onReorder(i, i + 1)}><Icon name="chevron-right" size={16} /></button>
                <button type="button" className="tk-iconbtn-plain" style={{ width: 30, height: 30, color: "#fff", marginInlineStart: "auto" }} aria-label="Set as cover" onClick={() => onSetCover && onSetCover(m.id)}><Icon name="star" size={16} /></button>
                <button type="button" className="tk-iconbtn-plain" style={{ width: 30, height: 30, color: "#fff" }} aria-label="Remove image" onClick={() => onRemove && onRemove(m.id)}><Icon name="trash-2" size={16} /></button>
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
