import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const clientCoreSyncRuntime = fileURLToPath(
  new URL("../../packages/client-core/src/sync-runtime.ts", import.meta.url),
);
const clientCoreSrc = fileURLToPath(
  new URL("../../packages/client-core/src/index.ts", import.meta.url),
);
const contractsSrc = fileURLToPath(
  new URL("../../packages/contracts/src/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [
      { find: "@tradeos/client-core/sync-runtime", replacement: clientCoreSyncRuntime },
      { find: /^@tradeos\/client-core$/, replacement: clientCoreSrc },
      { find: /^@tradeos\/contracts$/, replacement: contractsSrc },
    ],
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    globals: false,
  },
});
