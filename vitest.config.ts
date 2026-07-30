import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@open-chatgpt-skin/theme-schema": fileURLToPath(new URL("./packages/theme-schema/src/index.ts", import.meta.url)),
      "@open-chatgpt-skin/community-catalog": fileURLToPath(
        new URL("./packages/community-catalog/src/index.ts", import.meta.url),
      ),
      "@open-chatgpt-skin/theme-core": fileURLToPath(new URL("./packages/theme-core/src/index.ts", import.meta.url)),
      "@open-chatgpt-skin/cdp-adapter": fileURLToPath(
        new URL("./packages/cdp-adapter/src/index.ts", import.meta.url),
      ),
      "@open-chatgpt-skin/theme-studio-core": fileURLToPath(
        new URL("./packages/theme-studio-core/src/index.ts", import.meta.url),
      ),
      "@open-chatgpt-skin/runtime-contract": fileURLToPath(
        new URL("./packages/runtime-contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
