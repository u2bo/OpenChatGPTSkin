import { describe, expect, it, vi } from "vitest";
import {
  bootstrapTokenFromLocation,
  createHttpStudioBridge,
  establishStudioSession,
} from "../apps/theme-studio/src/bridge/http-studio-bridge.js";

describe("Theme Studio HTTP Bridge", () => {
  it("accepts only a 64-character lowercase hex fragment token", () => {
    expect(bootstrapTokenFromLocation(
      new URL(`http://127.0.0.1/#bootstrap=${"a".repeat(64)}`),
    )).toBe("a".repeat(64));

    let failure: unknown;
    try {
      bootstrapTokenFromLocation(new URL("http://127.0.0.1/#bootstrap=bad"));
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "STUDIO_SESSION_INVALID" });
  });

  it("exchanges the token, removes the fragment, and parses bootstrap", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        protocolVersion: 2,
        studioVersion: "0.1.0",
        capabilities: ["studio-shell"],
        runtime: {
          status: "stopped",
          controllerAvailable: false,
          selectedTheme: null,
          appliedTheme: null,
          skinApplied: false,
          packageVersion: null,
          operation: null,
          nextAction: "No managed session.",
        },
      }), { status: 200 }));
    const location = new URL(
      `http://127.0.0.1:4000/#bootstrap=${"a".repeat(64)}`,
    );
    const replace = vi.fn();

    await establishStudioSession(location, replace, fetchMock);
    await expect(createHttpStudioBridge(fetchMock).bootstrap())
      .resolves.toMatchObject({ runtime: { status: "stopped" } });
    expect(replace).toHaveBeenCalledWith("http://127.0.0.1:4000/");
  });

  it("reuses the existing authenticated session when the fragment is absent", async () => {
    const fetchMock = vi.fn();
    const replace = vi.fn();

    await establishStudioSession(
      new URL("http://127.0.0.1:4000/"),
      replace,
      fetchMock,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("deletes one encoded personal theme version through the authenticated API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ themes: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(createHttpStudioBridge(fetchMock).deletePersonalTheme({
      id: "personal-mountain",
      version: "1.0.2",
    })).resolves.toEqual({ themes: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/themes/personal-mountain?version=1.0.2",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
  });

  it("applies an exact saved theme reference through the high-level home action", async () => {
    const runtime = {
      status: "active",
      controllerAvailable: true,
      selectedTheme: { id: "mountain-mist", version: "1.2.2" },
      appliedTheme: { id: "mountain-mist", version: "1.2.2" },
      skinApplied: true,
      packageVersion: "26.715.0",
      operation: null,
      nextAction: "",
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(runtime), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(createHttpStudioBridge(fetchMock).applySavedTheme({
      id: "mountain-mist",
      version: "1.2.2",
    })).resolves.toEqual(runtime);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/themes/apply",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ id: "mountain-mist", version: "1.2.2" }),
      }),
    );
  });
});
