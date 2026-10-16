"use client";

import { useEffect, useState } from "react";
import { formatMoneyInput, getCurrencyMeta, parseMoneyInput } from "@tradeos/contracts";

export interface MoneyInputProps {
  /** Currency code (ISO 4217). The exponent drives formatting. */
  currencyCode: string;
  /** Current value in integer minor units, or null when empty. */
  valueMinor: number | null;
  /** Called with the new minor-unit integer (or null when the field is empty). */
  onChange: (valueMinor: number | null) => void;
  /** Field label (rendered above the input). */
  label?: string;
  /** Helper text below the input. */
  hint?: string;
  /** Error message — turns the border red. */
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "default" | "lg";
  id?: string;
  "aria-label"?: string;
  required?: boolean;
}

export function MoneyInput({
  currencyCode,
  valueMinor,
  onChange,
  label,
  hint,
  error,
  placeholder,
  disabled,
  size = "default",
  id,
  required,
  ...rest
}: MoneyInputProps) {
  const meta = getCurrencyMeta(currencyCode);
  const symbol = meta?.symbol ?? currencyCode;
  const [text, setText] = useState<string>(() =>
    valueMinor === null ? "" : (formatMoneyInput(valueMinor, currencyCode) ?? ""),
  );
  const [isFocused, setIsFocused] = useState(false);

  // Preserve what the user is typing. Controlled parent updates happen on every
  // keystroke, so formatting while focused can overwrite the in-progress text.
  useEffect(() => {
    if (isFocused) return;
    const formatted = valueMinor === null ? "" : (formatMoneyInput(valueMinor, currencyCode) ?? "");
    setText((prev) => (prev === formatted ? prev : formatted));
  }, [valueMinor, currencyCode, isFocused]);

  const handle = (raw: string) => {
    setText(raw);
    if (raw.trim() === "") {
      onChange(null);
      return;
    }
    const parsed = parseMoneyInput(raw, currencyCode);
    onChange(parsed);
  };

  const fieldId = id ?? `tos-money-${currencyCode}`;
  const cls = [
    "tos-money",
    size === "lg" ? " tos-money--lg" : "",
  ].join("");

  return (
    <div className="tos-field">
      {label ? (
        <label className="tos-field__label" htmlFor={fieldId}>
          {label}
          {required ? <span className="tos-field__label-required" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      <div className={cls}>
        <span className="tos-money__symbol" aria-hidden="true">{symbol}</span>
        <input
          {...rest}
          id={fieldId}
          type="text"
          inputMode="decimal"
          className="tos-money__input"
          value={text}
          onChange={(e) => handle(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder ?? "0"}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-label={rest["aria-label"] ?? label}
        />
      </div>
      {error ? <span className="tos-field__error">{error}</span> : hint ? <span className="tos-field__hint">{hint}</span> : null}
    </div>
  );
}
