import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const apiUrl = process.env.API_BASE_URL;
    if (!apiUrl) return [];
    return [
      { source: "/api/admin/:path*", destination: `${apiUrl.replace(/\/$/, "")}/api/admin/:path*` },
    ];
  },
};

export default config;
