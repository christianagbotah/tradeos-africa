import type { NextConfig } from "next";
import { resolve } from "node:path";

// The CI artifact pilot uses traced standalone bundles without changing
// how production releases are built or started today.
const artifactPilot = process.env.TRADEOS_CI_ARTIFACT === "1";

const config: NextConfig = {
  ...(artifactPilot ? {
    output: "standalone" as const,
    outputFileTracingRoot: resolve(process.cwd(), "../.."),
  } : {}),
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/reset-password",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }];
  },
};

export default config;
