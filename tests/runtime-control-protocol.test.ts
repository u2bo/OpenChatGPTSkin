import { describe, expect, it } from "vitest";
import {
  CONTROL_MAX_FRAME_BYTES,
  ControlRequestSchema,
  ControlResponseSchema,
  decodeControlFrame,
  encodeControlFrame,
  controlEndpointForIdentity,
  pipeNameForSid,
} from "@open-chatgpt-skin/windows-runtime";

const request = {
  protocolVersion: 1 as const,
  requestId: "00000000-0000-4000-8000-000000000001",
  command: "switch" as const,
  params: { themeId: "glacier-aurora" as const },
};

describe("Runtime control protocol", () => {
  it("accepts only fixed high-level commands", () => {
    expect(ControlRequestSchema.parse(request)).toEqual(request);
    expect(() => ControlRequestSchema.parse({
      ...request,
      command: "evaluate",
      params: { script: "alert(1)" },
    })).toThrow();
    expect(() => ControlRequestSchema.parse({
      ...request,
      params: { themeId: "glacier-aurora", css: "*{}" },
    })).toThrow();
    expect(() => ControlRequestSchema.parse({
      ...request,
      params: { themeId: "hatsune-miku-local" },
    })).toThrow();
    expect(ControlRequestSchema.parse({
      ...request,
      params: { themeId: "personal-mountain", themeVersion: "2.3.4" },
    })).toMatchObject({
      params: { themeId: "personal-mountain", themeVersion: "2.3.4" },
    });
  });

  it("round-trips exactly one bounded frame", () => {
    const frame = encodeControlFrame(request);
    expect(decodeControlFrame(frame)).toEqual(request);
    expect(() => decodeControlFrame(frame.subarray(0, frame.length - 1))).toThrow();
    expect(() => decodeControlFrame(Buffer.concat([frame, Buffer.from([0])]))).toThrow();
    expect(() => encodeControlFrame({ value: "x".repeat(CONTROL_MAX_FRAME_BYTES) }))
      .toThrow();
    expect(() => encodeControlFrame(["not", "an", "object"])).toThrow();
  });

  it("derives a stable Pipe name without exposing the SID", () => {
    const pipe = pipeNameForSid("S-1-5-21-secret");
    expect(pipe).toMatch(/^\\\\\.\\pipe\\OpenChatGPTSkin-[0-9a-f]{24}$/);
    expect(pipe).not.toContain("S-1-5-21-secret");
    expect(pipeNameForSid("S-1-5-21-secret")).toBe(pipe);
  });

  it("derives a private stable macOS socket path without exposing the UID", () => {
    const endpoint = controlEndpointForIdentity("uid:501", "darwin");
    expect(endpoint).toMatch(/^\/tmp\/OpenChatGPTSkin-[0-9a-f]{24}\.sock$/);
    expect(endpoint).not.toContain("uid:501");
    expect(controlEndpointForIdentity("uid:501", "darwin")).toBe(endpoint);
  });

  it("keeps result and error payloads free of sensitive fields", () => {
    const response = {
      protocolVersion: 1 as const,
      requestId: "00000000-0000-4000-8000-000000000001",
      ok: true as const,
      result: {
        status: "active" as const,
        controllerAvailable: true,
        selectedTheme: { id: "mountain-mist" as const, version: "1.0.0" },
        appliedTheme: { id: "mountain-mist" as const, version: "1.0.0" },
        skinApplied: true,
        packageVersion: "26.707.12708.0",
        operation: "switch" as const,
        nextAction: "None",
      },
    };

    expect(ControlResponseSchema.parse(response)).toEqual(response);
    expect(() => ControlResponseSchema.parse({
      ...response,
      result: { ...response.result, pid: 100 },
    })).toThrow();
    expect(() => ControlResponseSchema.parse({
      protocolVersion: 1,
      requestId: response.requestId,
      ok: false,
      error: {
        code: "RUNTIME_CONTROL_UNAVAILABLE",
        message: "Control endpoint is unavailable",
        webSocketUrl: "ws://127.0.0.1:9222/devtools",
      },
    })).toThrow();
  });

  it.each([
    "THEME_SCHEMA_VERSION_UNSUPPORTED",
    "THEME_WELCOME_INVALID",
    "THEME_DISPLAY_FONT_MISSING",
    "THEME_COMPOSITION_INVALID",
    "THEME_HOME_WELCOME_UNSUPPORTED",
    "THEME_REQUIRED_LAYER_UNRESOLVED",
  ] as const)("accepts the public v4 Runtime error code %s", (code) => {
    expect(ControlResponseSchema.parse({
      protocolVersion: 1,
      requestId: request.requestId,
      ok: false,
      error: {
        code,
        message: "Theme request was rejected safely.",
        nextAction: "Repair the theme or restore the previous theme.",
      },
    })).toMatchObject({ error: { code } });
  });
});
