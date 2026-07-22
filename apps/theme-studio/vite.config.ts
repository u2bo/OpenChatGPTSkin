import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { STUDIO_CSP_NONCE_PLACEHOLDER } from
  "../../packages/theme-studio-core/src/security.js";
import { injectNonceIntoInlineAssets } from
  "./build/nonce-production-assets.js";

function nonceProductionAssets(): Plugin {
  return {
    name: "open-chatgpt-skin-production-nonce",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "asset" || !output.fileName.endsWith(".html")) {
          continue;
        }
        output.source = injectNonceIntoInlineAssets(
          String(output.source),
          STUDIO_CSP_NONCE_PLACEHOLDER,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), nonceProductionAssets()],
  resolve: {
    alias: {
      "@open-chatgpt-skin/theme-schema": fileURLToPath(
        new URL("../../packages/theme-schema/src/index.ts", import.meta.url),
      ),
      "@open-chatgpt-skin/theme-studio-core": fileURLToPath(
        new URL("../../packages/theme-studio-core/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
