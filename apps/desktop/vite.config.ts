import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

/**
 * Vite config for the TradeOS desktop client.
 *
 * The workspace packages (@tradeos/client-core, @tradeos/contracts) ship
 * `types` -> `src/index.ts` but a `default` -> `dist/index.js` export that is
 * only present after `pnpm -r build`. For a smooth dev loop we alias the bare
 * specifiers directly to their TypeScript source so the desktop app can be
 * developed and built without pre-building the workspace packages.
 *
 * RegExp finds guarantee exact-match only, so the relative
 * `export * from "./sync-runtime.js"` inside the source resolves to the `.ts`
 * file via Vite's default extension resolution rather than being rewritten.
 */
const clientCoreSrc = fileURLToPath(
  new URL("../../packages/client-core/src/index.ts", import.meta.url),
);
const contractsSrc = fileURLToPath(
  new URL("../../packages/contracts/src/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@tradeos\/client-core$/, replacement: clientCoreSrc },
      { find: /^@tradeos\/contracts$/, replacement: contractsSrc },
    ],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
