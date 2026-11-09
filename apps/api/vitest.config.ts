import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/test-database-guard-setup.ts"],
  },
});
