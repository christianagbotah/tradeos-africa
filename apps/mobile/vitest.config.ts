import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@tradeos/client-core/sync-runtime": fileURLToPath(
        new URL("../../packages/client-core/src/sync-runtime.ts", import.meta.url),
      ),
    },
  },
});
