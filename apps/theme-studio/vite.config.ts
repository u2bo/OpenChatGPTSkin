import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
  },
});
