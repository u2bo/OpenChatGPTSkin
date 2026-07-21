import { describe, expect, it, vi } from "vitest";
import { RuntimeThemeError } from "@open-chatgpt-skin/cdp-adapter";
import {
  ThemeEngine,
  connectRuntimePage,
  type LoadedRuntimeTheme,
  type RuntimePageSession,
  type RuntimeThemeRepository,
} from "@open-chatgpt-skin/windows-runtime";

describe("connectRuntimePage", () => {
  it("uses the unique DOM-capable target and waits for the Adapter", async () => {
    const target = {
      id: "codex",
      type: "page",
      title: "Codex",
      url: "app://-/index.html",
      webSocketDebuggerUrl: "ws://127.0.0.1:55123/devtools/page/codex",
    };
    const connection = {
      evaluate: vi.fn(),
      close: vi.fn(),
      on: vi.fn(() => () => undefined),
      onClose: vi.fn(() => () => undefined),
    };
    const waitForTarget = vi.fn(async () => target);
    const connect = vi.fn(async () => connection);
    const createAdapter = vi.fn(() => ({
      probe: vi.fn(async () => ({
        adapterId: "current-2026-07",
        compatible: true,
        missing: [],
      })),
      apply: vi.fn(),
      verify: vi.fn(),
      verifyOfficialAppearance: vi.fn(),
      remove: vi.fn(),
    }));
    const waitForAdapter = vi.fn(async (adapter) => adapter.probe());

    const session = await connectRuntimePage(
      { host: "127.0.0.1", port: 55123 },
      { waitForTarget, connect, createAdapter, waitForAdapter },
    );

    expect(session.target).toBe(target);
    expect(session.adapterId).toBe("current-2026-07");
    expect(waitForTarget).toHaveBeenCalledWith(
      { host: "127.0.0.1", port: 55123 },
      { timeoutMs: 30_000, intervalMs: 100 },
    );
    session.close();
    expect(connection.close).toHaveBeenCalledOnce();
  });
});

describe("ThemeEngine", () => {
  const theme = {
    descriptor: { id: "mountain-mist", name: "山峦云海", version: "1.0.0", ready: true },
    bundle: {},
    compiled: {},
  } as unknown as LoadedRuntimeTheme;

  it("loads from the reviewed repository and maps local Adapter errors", async () => {
    const repository = { load: vi.fn(async () => theme) } as unknown as RuntimeThemeRepository;
    const cause = new RuntimeThemeError("THEME_APPLY_FAILED", "local Adapter diagnostic");
    const session = {
      adapter: {
        apply: vi.fn(async () => { throw cause; }),
      },
    } as unknown as RuntimePageSession;
    const engine = new ThemeEngine(repository);

    await expect(engine.load("mountain-mist")).resolves.toBe(theme);
    await expect(engine.apply(session, theme)).rejects.toMatchObject({
      code: "THEME_APPLY_FAILED",
      cause,
    });
    expect(repository.load).toHaveBeenCalledWith("mountain-mist");
  });

  it("fails cleanup when official appearance is not verified", async () => {
    const repository = { load: vi.fn() } as unknown as RuntimeThemeRepository;
    const session = {
      adapter: {
        remove: vi.fn(async () => {}),
        verifyOfficialAppearance: vi.fn(async () => ({ valid: false })),
      },
    } as unknown as RuntimePageSession;

    await expect(new ThemeEngine(repository).cleanup(session))
      .rejects.toMatchObject({ code: "THEME_CLEANUP_FAILED" });
  });
});
