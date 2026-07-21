import { describe, expect, it } from "vitest";
import { createStudioSession } from "@open-chatgpt-skin/theme-studio-service";

describe("Theme Studio session authentication", () => {
  it("exchanges the bootstrap token exactly once", () => {
    const values = ["a".repeat(64), "b".repeat(64)];
    const session = createStudioSession(() => values.shift()!);

    expect(session.exchange(session.bootstrapToken)).toBe("b".repeat(64));

    let failure: unknown;
    try {
      session.exchange(session.bootstrapToken);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "STUDIO_SESSION_INVALID" });
  });

  it("verifies only the exact session cookie", () => {
    const values = ["a".repeat(64), "b".repeat(64)];
    const session = createStudioSession(() => values.shift()!);
    const cookie = session.exchange(session.bootstrapToken);

    expect(session.verifyCookie(`other=x; ocs_studio_session=${cookie}`)).toBe(true);
    expect(session.verifyCookie(`ocs_studio_session=${"c".repeat(64)}`)).toBe(false);
    expect(session.verifyCookie(undefined)).toBe(false);
  });
});
