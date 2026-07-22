function tagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  throw new Error("Theme Studio production HTML contains an unclosed tag");
}

function declareCspNonce(html: string, nonce: string): string {
  const existingMetadata = /<meta\b[^>]*\bproperty\s*=\s*(["'])csp-nonce\1[^>]*>/i;
  if (existingMetadata.test(html)) {
    throw new Error("Theme Studio production HTML already declares a CSP nonce");
  }

  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (!head) {
    throw new Error("Theme Studio production HTML is missing its <head> tag");
  }

  const insertionPoint = head.index + head[0].length;
  const metadata = `<meta property="csp-nonce" nonce="${nonce}">`;
  return html.slice(0, insertionPoint) + metadata + html.slice(insertionPoint);
}

/**
 * Declares the production CSP nonce and adds it only to real HTML asset tags.
 * Script and style bodies are raw text in HTML, so scanning inside them can
 * corrupt JavaScript string literals.
 */
export function injectNonceIntoInlineAssets(
  html: string,
  nonce: string,
): string {
  html = declareCspNonce(html, nonce);
  const openingTag = /<(script|style)(?=[\s/>])/gi;
  let cursor = 0;
  let output = "";
  let match: RegExpExecArray | null;

  while ((match = openingTag.exec(html)) !== null) {
    const name = match[1]!.toLowerCase();
    const start = match.index;
    const openEnd = tagEnd(html, start);
    const opening = html.slice(start, openEnd + 1);
    const withNonce = /\snonce\s*=/i.test(opening)
      ? opening
      : opening.replace(
        /^<(script|style)/i,
        `<$1 nonce="${nonce}"`,
      );
    const closingTag = new RegExp(`</${name}\\s*>`, "gi");
    closingTag.lastIndex = openEnd + 1;
    const closing = closingTag.exec(html);
    if (!closing) {
      throw new Error(`Theme Studio production HTML contains an unclosed <${name}> tag`);
    }
    const closeEnd = closing.index + closing[0].length;

    output += html.slice(cursor, start);
    output += withNonce;
    output += html.slice(openEnd + 1, closeEnd);
    cursor = closeEnd;
    openingTag.lastIndex = closeEnd;
  }

  return output + html.slice(cursor);
}
