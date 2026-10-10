import React, { forwardRef, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  currencyCode: string;
};

export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput(
  { currencyCode, inputMode = "decimal", ...props },
  ref,
) {
  const currency = currencyCode === "GHS" ? "₵" : currencyCode;
  return (
    <span className="tos-money-input">
      <span className="tos-money-input__currency" aria-hidden="true">{currency}</span>
      <input ref={ref} inputMode={inputMode} {...props} />
    </span>
  );
});
