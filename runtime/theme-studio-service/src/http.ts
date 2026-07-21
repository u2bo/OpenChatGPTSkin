import type { IncomingMessage, ServerResponse } from "node:http";
import { StudioError } from "@open-chatgpt-skin/theme-studio-core";

export const STUDIO_JSON_LIMIT_BYTES = 256 * 1024;

export async function readBoundedJson(
  request: IncomingMessage,
  limit: number = STUDIO_JSON_LIMIT_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > limit) {
      throw new StudioError(
        "STUDIO_REQUEST_TOO_LARGE",
        "JSON request exceeds its limit",
      );
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StudioError(
      "STUDIO_REQUEST_INVALID",
      "Request is not valid JSON",
    );
  }
}

export async function readBoundedBytes(
  request: IncomingMessage,
  limit: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new StudioError("INTERNAL", "Binary request limit is invalid");
  }
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined && Number(contentLength) > limit) {
    throw new StudioError("STUDIO_REQUEST_TOO_LARGE", "Binary request exceeds its limit");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > limit) {
      throw new StudioError("STUDIO_REQUEST_TOO_LARGE", "Binary request exceeds its limit");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export function assertExactOrigin(
  request: IncomingMessage,
  origin: string,
): void {
  if (request.headers.origin !== origin) {
    throw new StudioError(
      "STUDIO_ORIGIN_REJECTED",
      "Origin is not authorized",
    );
  }
}

export function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

export function writeBytes(
  response: ServerResponse,
  status: number,
  body: Uint8Array,
  contentType: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}
