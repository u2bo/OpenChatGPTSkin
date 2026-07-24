import { describe, expect, it } from "vitest";
import {
  STUDIO_PROTOCOL_VERSION,
  StudioBootstrapSchema,
  StudioAssetSlotSchema,
  StudioError,
  StudioEventSchema,
} from "@open-chatgpt-skin/theme-studio-core";

const stoppedRuntime = {
  status: "stopped" as const,
  controllerAvailable: false,
  selectedTheme: null,
  appliedTheme: null,
  skinApplied: false,
  packageVersion: null,
  operation: null,
  nextAction: "No managed Runtime session.",
};

describe("Theme Studio Bridge contracts", () => {
  it("parses strict bootstrap and event payloads", () => {
    expect(StudioBootstrapSchema.parse({
      protocolVersion: STUDIO_PROTOCOL_VERSION,
      studioVersion: "0.1.0-alpha.1",
      capabilities: ["studio-shell"],
      runtime: stoppedRuntime,
    })).toMatchObject({ protocolVersion: 2, repositoryUrl: null });

    expect(StudioEventSchema.parse({
      protocolVersion: 2,
      sequence: 1,
      kind: "runtime-status",
      runtime: stoppedRuntime,
    })).toMatchObject({ sequence: 1 });
  });

  it("rejects unknown properties and invalid theme references", () => {
    expect(() => StudioBootstrapSchema.parse({
      protocolVersion: 2,
      studioVersion: "0.1.0",
      capabilities: ["studio-shell"],
      runtime: {
        ...stoppedRuntime,
        status: "active",
        selectedTheme: { id: "Bad ID", version: "latest" },
      },
      unsafe: true,
    })).toThrow();
    expect(() => StudioBootstrapSchema.parse({
      protocolVersion: 2,
      studioVersion: "0.1.0-preview",
      capabilities: ["studio-shell"],
      runtime: stoppedRuntime,
    })).toThrow();
  });

  it("keeps stable Studio foundation error codes", () => {
    expect(new StudioError("STUDIO_SESSION_INVALID", "invalid")).toMatchObject({
      code: "STUDIO_SESSION_INVALID",
    });
  });

  it("accepts every controlled interface imagery upload slot", () => {
    for (const slot of [
      "profile-avatar",
      "suggestion-card1",
      "suggestion-card2",
      "suggestion-card3",
      "suggestion-card4",
      "project-icon1",
      "project-icon2",
      "project-icon3",
      "project-icon4",
    ]) {
      expect(StudioAssetSlotSchema.parse(slot)).toBe(slot);
    }
    expect(() => StudioAssetSlotSchema.parse("suggestion-card5")).toThrow();
  });

  it("exposes display-font and composition-layer upload slots", () => {
    expect(StudioAssetSlotSchema.options).toEqual(expect.arrayContaining([
      "display-font",
      "composition-layer",
    ]));
  });
});
