import { randomBytes, timingSafeEqual } from "node:crypto";
import { StudioError } from "@open-chatgpt-skin/theme-studio-core";

export const STUDIO_COOKIE_NAME = "ocs_studio_session";

function defaultToken(): string {
  return randomBytes(32).toString("hex");
}

function validToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function sameToken(left: string, right: string): boolean {
  return validToken(left) && validToken(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function cookieValue(header: string | undefined): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() === STUDIO_COOKIE_NAME) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export interface StudioSession {
  readonly bootstrapToken: string;
  exchange(token: string): string;
  verifyCookie(header: string | undefined): boolean;
}

export function createStudioSession(
  newToken: () => string = defaultToken,
): StudioSession {
  const bootstrapToken = newToken();
  let available = true;
  let sessionToken: string | null = null;

  return {
    bootstrapToken,
    exchange(token) {
      if (!available || !sameToken(token, bootstrapToken)) {
        throw new StudioError(
          "STUDIO_SESSION_INVALID",
          "Bootstrap token is invalid or already used",
        );
      }
      available = false;
      sessionToken = newToken();
      return sessionToken;
    },
    verifyCookie(header) {
      const candidate = cookieValue(header);
      return sessionToken !== null && candidate !== undefined &&
        sameToken(candidate, sessionToken);
    },
  };
}
