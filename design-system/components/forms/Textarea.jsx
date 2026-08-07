import React from "react";
export function Textarea({ className = "", maxLength, value, ...rest }) {
  return (
    <>
      <textarea className={["tk-textarea", className].filter(Boolean).join(" ")} maxLength={maxLength} value={value} {...rest} />
      {maxLength != null && <span className="tk-help" style={{ alignSelf: "flex-end" }}>{(value || "").length}/{maxLength}</span>}
    </>
  );
}
