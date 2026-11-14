"use client";

import { useState, type InputHTMLAttributes } from "react";

/** Accessible password reveal control; no change to field name, form or autocomplete. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="tos-password-field">
      <input {...props} type={visible ? "text" : "password"}
        className={props.className ?? "tos-input"} />
      <button type="button" className="tos-password-field__toggle"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={props.id}
        onClick={() => setVisible((current) => !current)}>
        {visible ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <path d="M3 3l18 18" />
            <path d="M10.6 5.1A10.8 10.8 0 0112 5c4.5 0 8.3 2.7 10 7-0.7 1.8-1.9 3.4-3.5 4.6" />
            <path d="M6.5 6.5C4.3 7.9 2.9 9.7 2 12c1.7 4.3 5.5 7 10 7 1.5 0 2.9-.3 4.2-.9" />
            <path d="M10 10a2.83 2.83 0 004 4" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </span>
  );
}
