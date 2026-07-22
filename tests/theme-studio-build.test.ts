import { Script } from "node:vm";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { injectNonceIntoInlineAssets } from
  "../apps/theme-studio/build/nonce-production-assets.js";

describe("Theme Studio production HTML", () => {
  it("adds nonces without rewriting script source text", () => {
    const source = [
      "<!doctype html><html><head>",
      '<script type="module">const markup = "<script><\\/script>";</script>',
      "<style>body{margin:0}</style>",
      "</head><body></body></html>",
    ].join("");

    const html = injectNonceIntoInlineAssets(source, "nonce-placeholder");
    const { document } = parseHTML(html);
    const nonceMetadata = document.querySelectorAll('meta[property="csp-nonce"]');
    const script = document.querySelector("script")!;
    const style = document.querySelector("style")!;

    expect(nonceMetadata).toHaveLength(1);
    expect(nonceMetadata[0]?.getAttribute("nonce")).toBe("nonce-placeholder");
    expect(script.getAttribute("nonce")).toBe("nonce-placeholder");
    expect(style.getAttribute("nonce")).toBe("nonce-placeholder");
    expect(script.textContent).toContain('"<script><\\/script>"');
    expect(() => new Script(script.textContent)).not.toThrow();
  });
});
