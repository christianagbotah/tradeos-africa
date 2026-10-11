import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tradeos/contracts", "@tradeos/client-core"],
};

export default config;
