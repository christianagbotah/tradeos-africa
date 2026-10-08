import React from "react";
import type { ButtonHTMLAttributes } from "react";
export function Button({variant="primary",size="default",className="",...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:"primary"|"secondary"|"ghost"|"danger";size?:"default"|"compact"}){return <button {...props} className={`tos-button tos-button--${variant} tos-button--${size} ${className}`.trim()}/>;}
