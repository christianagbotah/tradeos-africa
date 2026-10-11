"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant =
  | "default"
  | "primary"
  | "gold"
  | "positive"
  | "danger"
  | "ghost"
  | "outline";

export type ButtonSize = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: "",
  primary: " tos-btn--primary",
  gold: " tos-btn--gold",
  positive: " tos-btn--positive",
  danger: " tos-btn--danger",
  ghost: " tos-btn--ghost",
  outline: " tos-btn--outline",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  default: "",
  sm: " tos-btn--sm",
  lg: " tos-btn--lg",
  icon: " tos-btn--icon",
};

export function Button({
  variant = "default",
  size = "default",
  block = false,
  loading = false,
  icon,
  iconRight,
  children,
  disabled,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = [
    "tos-btn",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    block ? " tos-btn--block" : "",
    className ? ` ${className}` : "",
  ].join("");
  return (
    <button
      {...rest}
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <span className="tos-btn__spinner" aria-hidden="true" />
      ) : icon ? (
        <span className="tos-btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
      {iconRight ? (
        <span className="tos-btn__icon" aria-hidden="true">
          {iconRight}
        </span>
      ) : null}
    </button>
  );
}
