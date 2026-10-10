import type { Metadata, Viewport } from "next";
import "./tradeos-tokens.css";
import "./ui-primitives.css";
import "./workspace-shell.css";
import "./tradeos-app.css";
import "./dashboard.css";
import "./catalog.css";
import "./pos.css";
import "./customers-credit.css";
import "./zai-reference.css";

export const metadata: Metadata = {
  title: "TradeOS Africa",
  description: "The operating system for African businesses.",
  applicationName: "TradeOS Africa",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#08261c",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
