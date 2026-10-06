import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./returns.css";
import "./interactions.css";
import "./real-app.css";
import "./sales-returns.css";
import "./customers-credit.css";

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
