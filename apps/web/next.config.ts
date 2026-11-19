import type { NextConfig } from "next";
import { basename, resolve } from "node:path";

// The deployed release directory is named after its immutable Git commit.
// Bake that identity into BOTH the browser bundle and the server endpoint:
// deriving it from the server on first poll would mistake an old tab for new.
const releaseFolder = basename(resolve(process.cwd(), "../.."));
const candidateReleaseId = process.env.TRADEOS_RELEASE_SHA || process.env.GITHUB_SHA || releaseFolder;
const clientReleaseId = /^[a-f0-9]{40}$/i.test(candidateReleaseId) ? candidateReleaseId : "";

const config: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_TRADEOS_CLIENT_RELEASE: clientReleaseId },
  async headers() {
    // Sensitive redirect arguments must not be cached or sent as referrers.
    return ["/reset-password", "/gateway-test-return"].map(source => ({
      source,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }));
  },
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
