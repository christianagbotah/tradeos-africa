import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./admin-tokens.css";
import "./admin-shell.css";
import "./admin-components.css";

export const metadata: Metadata = {
  title: "TradeOS System Admin",
  description: "TradeOS Africa platform control plane — for super admins, support, compliance and billing.",
  applicationName: "TradeOS System Admin",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1424",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
