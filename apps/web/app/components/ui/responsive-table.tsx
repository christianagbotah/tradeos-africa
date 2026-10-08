import React, { type HTMLAttributes, type ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

export function ResponsiveTable({ children, className = "", ...props }: Props) {
  return <div className={`tradeos-responsive-table ${className}`.trim()} {...props}>{children}</div>;
}
