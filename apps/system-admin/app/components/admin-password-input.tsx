"use client";

import { useState, type InputHTMLAttributes } from "react";

export function AdminPasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="admin-password-control">
      <input {...props} type={visible ? "text" : "password"} />
      <button type="button" className="admin-password-control__toggle"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        aria-pressed={visible} aria-controls={props.id}
        onClick={() => setVisible((current) => !current)}>
        {visible ? (
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0112 5c4.5 0 8.3 2.7 10 7-.7 1.8-1.9 3.4-3.5 4.6M6.5 6.5C4.3 7.9 2.9 9.7 2 12c1.7 4.3 5.5 7 10 7 1.5 0 2.9-.3 4.2-.9M10 10a2.83 2.83 0 004 4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </span>
  );
}
