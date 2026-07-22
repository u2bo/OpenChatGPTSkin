import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  RuntimeError,
  RuntimeThemeRepository,
  parseRuntimeArguments,
  runRuntimeCli,
  type ControlRequest,
  type ControlResponse,
  type RuntimeCliDependencies,
  type RuntimeSessionState,
} from "@open-chatgpt-skin/windows-runtime";
import { makeRuntimeState } from "./helpers/runtime-fixture.js";

function successResponseFor(request: ControlRequest): ControlResponse {
  const themeId = request.command === "launch" || request.command === "switch"
    ? request.params.themeId
    : null;
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    result: {
      status: request.command === "launch" || request.command === "switch"
        ? "active"
        : "stopped",
      controllerAvailable: true,
      selectedTheme: themeId ? { id: themeId, version: "1.0.0" } : null,
      appliedTheme: themeId ? { id: themeId, version: "1.0.0" } : null,
      skinApplied: themeId ? true : false,
      packageVersion: themeId ? "26.707.12708.0" : null,
      operation: null,
      nextAction: themeId
        ? "Use status, switch, pause, or restore."
        : "Launch a theme.",
    },
  };
}

function successStatusResponse(): ControlResponse {
  return successResponseFor({
    protocolVersion: 1,
    requestId: "00000000-0000-4000-8000-000000000002",
    command: "status",
    params: {},
  });
}

function io(output: string[]) {
  return {
    stdout: (value: string) => output.push(value),
    stderr: (value: string) => output.push(value),
  };
}

function fakeCliDependencies(options: {
  readonly state?: RuntimeSessionState | null;
  readonly pipeAvailable?: boolean;
} = {}): RuntimeCliDependencies & {
  readonly startController: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
} {
  let pipeAvailable = options.pipeAvailable ?? true;
  const startController = vi.fn(async () => { pipeAvailable = true; });
  return {
    themes: new RuntimeThemeRepository(resolve("themes")),
    state: { read: vi.fn(async () => options.state ?? null) },
    currentUserSid: async () => "S-1-5-21-test",
    startController,
    newRequestId: () => "00000000-0000-4000-8000-000000000001",
    send: vi.fn(async (_sid, request: ControlRequest) => {
      if (!pipeAvailable) {
        throw new RuntimeError("RUNTIME_CONTROL_UNAVAILABLE", "Pipe is absent");
      }
      return successResponseFor(request);
    }),
  };
}

describe("Runtime CLI arguments", () => {
  it("accepts only fixed public command forms", () => {
    expect(parseRuntimeArguments(["launch", "--theme", "mountain-mist"]))
      .toEqual({ kind: "launch", themeId: "mountain-mist" });
    expect(parseRuntimeArguments(["switch", "--theme", "glacier-aurora"]))
      .toEqual({ kind: "switch", themeId: "glacier-aurora" });
    expect(parseRuntimeArguments([
      "switch",
      "--theme",
      "personal-mountain",
      "--version",
      "2.3.4",
    ])).toEqual({
      kind: "switch",
      themeId: "personal-mountain",
      themeVersion: "2.3.4",
    });
    expect(parseRuntimeArguments([
      "import",
      "--theme-file",
      "D:\\Themes\\personal-mountain.ocskin",
    ])).toEqual({
      kind: "import",
      themeFile: "D:\\Themes\\personal-mountain.ocskin",
    });
    for (const args of [
      ["launch", "--theme", "hatsune-miku-local"],
      ["launch", "--port", "9222"],
      ["switch", "--css", "*{}"],
      ["status", "--cdp-url", "ws://127.0.0.1:1"],
      ["serve"],
    ]) expect(() => parseRuntimeArguments(args)).toThrow();
  });

  it("lists only the four ready built-ins without starting a Controller", async () => {
    const dependencies = fakeCliDependencies();
    const output: string[] = [];

    expect(await runRuntimeCli(["list-themes"], dependencies, {
      stdout: (value) => output.push(value),
      stderr: vi.fn(),
    })).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      themes: [
        { id: "future-idol-cyan" },
        { id: "rose-carpet-star" },
        { id: "mountain-mist" },
        { id: "glacier-aurora" },
      ],
    });
    expect(dependencies.startController).not.toHaveBeenCalled();
  });

  it("imports an exact ocskin file without starting a Controller", async () => {
    const dependencies = fakeCliDependencies();
    const importFile = vi.spyOn(dependencies.themes, "importFile").mockResolvedValue({
      id: "personal-mountain",
      name: "个人山岚",
      version: "2.3.4",
      ready: true,
    });
    const output: string[] = [];

    expect(await runRuntimeCli([
      "import",
      "--theme-file",
      "D:\\Themes\\personal-mountain.ocskin",
    ], dependencies, io(output))).toBe(0);
    expect(importFile).toHaveBeenCalledWith("D:\\Themes\\personal-mountain.ocskin");
    expect(JSON.parse(output.join(""))).toEqual({
      theme: {
        id: "personal-mountain",
        name: "个人山岚",
        version: "2.3.4",
        ready: true,
      },
    });
    expect(dependencies.startController).not.toHaveBeenCalled();
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("returns stopped without spawning recovery when no state exists", async () => {
    const dependencies = fakeCliDependencies({ state: null, pipeAvailable: false });
    const output: string[] = [];

    expect(await runRuntimeCli(["status"], dependencies, io(output))).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({ status: "stopped" });
    expect(dependencies.startController).not.toHaveBeenCalled();
  });

  it("starts recovery mode when state exists but the Pipe is absent", async () => {
    const dependencies = fakeCliDependencies({
      state: makeRuntimeState({ status: "active" }),
      pipeAvailable: false,
    });

    expect(await runRuntimeCli(["status"], dependencies, io([]))).toBe(0);
    expect(dependencies.startController).toHaveBeenCalledWith("recover");
  });

  it("writes exactly one JSON object to the correct stream", async () => {
    const successOut: string[] = [];
    const successErr: string[] = [];
    expect(await runRuntimeCli(["status"], fakeCliDependencies(), {
      stdout: (value) => successOut.push(value),
      stderr: (value) => successErr.push(value),
    })).toBe(0);
    expect(successOut).toHaveLength(1);
    expect(successErr).toHaveLength(0);
    expect(() => JSON.parse(successOut[0]!)).not.toThrow();

    const failureOut: string[] = [];
    const failureErr: string[] = [];
    expect(await runRuntimeCli(["launch", "--theme", "missing"], fakeCliDependencies(), {
      stdout: (value) => failureOut.push(value),
      stderr: (value) => failureErr.push(value),
    })).toBe(64);
    expect(failureOut).toHaveLength(0);
    expect(failureErr).toHaveLength(1);
    expect(() => JSON.parse(failureErr[0]!)).not.toThrow();
  });

  it.each([
    ["theme validation", 65, new RuntimeError("THEME_NOT_FOUND", "missing"), null],
    ["active controller unavailable", 69, new RuntimeError("RUNTIME_CONTROL_UNAVAILABLE", "missing pipe"), makeRuntimeState({ status: "active" })],
    ["unknown failure", 70, new Error("unknown"), null],
  ] as const)("maps %s to exit %i", async (_name, expectedExit, error, state) => {
    const dependencies = fakeCliDependencies({ state });
    vi.mocked(dependencies.send).mockImplementation(async () => { throw error; });

    expect(await runRuntimeCli(["status"], dependencies, io([]))).toBe(expectedExit);
  });

  it.each([
    "THEME_SCHEMA_VERSION_UNSUPPORTED",
    "THEME_WELCOME_INVALID",
    "THEME_DISPLAY_FONT_MISSING",
    "THEME_COMPOSITION_INVALID",
    "THEME_HOME_WELCOME_UNSUPPORTED",
    "THEME_REQUIRED_LAYER_UNRESOLVED",
  ] as const)("maps %s to the theme validation exit", async (code) => {
    const dependencies = fakeCliDependencies();
    vi.mocked(dependencies.send).mockRejectedValue(new RuntimeError(code, "invalid theme"));

    expect(await runRuntimeCli(["status"], dependencies, io([]))).toBe(65);
  });

  it("retries a Pipe winner after a Controller startup race", async () => {
    const dependencies = fakeCliDependencies({ pipeAvailable: false });
    vi.mocked(dependencies.startController)
      .mockRejectedValueOnce(new RuntimeError("RUNTIME_CONTROL_UNAVAILABLE", "Pipe already exists"));
    vi.mocked(dependencies.send)
      .mockRejectedValueOnce(new RuntimeError("RUNTIME_CONTROL_UNAVAILABLE", "not ready"))
      .mockResolvedValueOnce(successStatusResponse());

    expect(await runRuntimeCli(
      ["launch", "--theme", "mountain-mist"],
      dependencies,
      io([]),
    )).toBe(0);
    expect(dependencies.startController).toHaveBeenCalledTimes(1);
    expect(dependencies.send).toHaveBeenCalledTimes(2);
  });

  it("gives mutations a bounded sixty-second response window", async () => {
    const dependencies = fakeCliDependencies();

    expect(await runRuntimeCli(
      ["launch", "--theme", "mountain-mist"],
      dependencies,
      io([]),
    )).toBe(0);
    expect(dependencies.send).toHaveBeenCalledWith(
      "S-1-5-21-test",
      expect.objectContaining({ command: "launch" }),
      60_000,
    );
  });

  it("maps a 20-second startup timeout to unavailable", async () => {
    vi.useFakeTimers();
    try {
      const dependencies = fakeCliDependencies({ pipeAvailable: false });
      vi.mocked(dependencies.startController).mockImplementation(
        () => new Promise<void>(() => undefined),
      );
      const result = runRuntimeCli(
        ["launch", "--theme", "mountain-mist"],
        dependencies,
        io([]),
        { startupTimeoutMs: 20_000 },
      );
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(result).resolves.toBe(69);
    } finally {
      vi.useRealTimers();
    }
  });
});
