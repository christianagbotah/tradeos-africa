import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./tradeos-tokens.css";
import "./ui-primitives.css";
import "./workspace-shell.css";

export const metadata: Metadata = {
  title: "TradeOS",
  description: "The business OS for African trade — sell, track, and reconcile from any device.",
  applicationName: "TradeOS",
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
