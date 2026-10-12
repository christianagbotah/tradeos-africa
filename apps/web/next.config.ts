import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tradeos/contracts", "@tradeos/client-core"],
  async rewrites() {
    // In development, proxy /v1/ API calls to the API server.
    // In production, Caddy or a reverse proxy handles this.
    const apiUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
    return [
      { source: "/v1/:path*", destination: `${apiUrl}/v1/:path*` },
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
    ];
  },
};

export default config;
