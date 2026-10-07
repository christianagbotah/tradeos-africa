import React, { type HTMLAttributes, type ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

export function PageToolbar({ children, className = "", ...props }: Props) {
  return <div className={`tradeos-page-toolbar ${className}`.trim()} {...props}>{children}</div>;
}
