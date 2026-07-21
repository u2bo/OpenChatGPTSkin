import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@open-chatgpt-skin/theme-schema": fileURLToPath(new URL("./packages/theme-schema/src/index.ts", import.meta.url)),
      "@open-chatgpt-skin/theme-core": fileURLToPath(new URL("./packages/theme-core/src/index.ts", import.meta.url)),
      "@open-chatgpt-skin/cdp-adapter": fileURLToPath(
        new URL("./packages/cdp-adapter/src/index.ts", import.meta.url),
      ),
      "@open-chatgpt-skin/theme-studio-core": fileURLToPath(
        new URL("./packages/theme-studio-core/src/index.ts", import.meta.url),
      ),
      "@open-chatgpt-skin/theme-studio-service": fileURLToPath(
        new URL("./runtime/theme-studio-service/src/index.ts", import.meta.url),
      ),
      "@open-chatgpt-skin/windows-runtime": fileURLToPath(
        new URL("./runtime/windows/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // The secured Windows Pipe has one intentional name per user SID.
    fileParallelism: process.platform !== "win32",
    coverage: { reporter: ["text", "json-summary"] },
  },
});
