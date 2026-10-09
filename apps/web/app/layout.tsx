import type { Metadata, Viewport } from "next";
import "./tradeos-tokens.css";
import "./globals.css";
import "./purchases-inventory.css";
import "./returns.css";
import "./interactions.css";
import "./public-entry.css";
import "./sales-returns.css";
import "./transaction-evidence.css";
import "./customers-credit.css";
import "./workspace-shell.css";
import "./ui-primitives.css";
import "./dashboard.css";
import "./catalog.css";
import "./pos.css";
import "./cashbook.css";
import "./operations.css";
import "./master-data.css";

export const metadata: Metadata = {
  title: "TradeOS Africa",
  description: "The operating system for African businesses.",
  applicationName: "TradeOS Africa",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
