import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Theme Studio appearance styles", () => {
  it("keeps editor tool hover text readable in both color modes", async () => {
    const css = await readFile("apps/theme-studio/src/styles.css", "utf8");
    expect(css).toContain(
      "[data-studio-theme] .tool-list button:not(:disabled):hover",
    );
    expect(css).toContain(
      "background: color-mix(in srgb, var(--app-accent) 14%, var(--app-panel-solid));",
    );
  });
});
