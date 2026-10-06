import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TradeOS Africa",
    short_name: "TradeOS",
    description: "Offline-first business operating system for African businesses.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#0f172a",
    categories: ["business", "finance", "productivity"],
  };
}
