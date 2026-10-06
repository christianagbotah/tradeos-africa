import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "TradeOS System Admin",
  description: "TradeOS Africa platform control plane",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
