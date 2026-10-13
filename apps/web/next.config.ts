import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tradeos/contracts", "@tradeos/client-core"],
  async rewrites() {
    // Dev/proxy mode ONLY: rewrites are installed when API_BASE_URL is
    // explicitly supplied (e.g. Visual QA / local dev behind one origin).
    // When it is absent — including production — this returns [] so requests
    // are served by Caddy / the reverse proxy. Never silently assume localhost.
    const apiUrl = process.env.API_BASE_URL;
    if (!apiUrl) {
      return [];
    }
    return [
      { source: "/v1/:path*", destination: `${apiUrl}/v1/:path*` },
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
    ];
  },
};

export default config;
