import { RuntimeThemeError } from "./errors.js";
import {
  applyExpression,
  PROBE_EXPRESSION,
  REMOVE_EXPRESSION,
  VERIFY_EXPRESSION,
  VERIFY_OFFICIAL_EXPRESSION,
} from "./scripts.js";
import type {
  AdapterProbe,
  AdapterVerification,
  CdpRuntimeClient,
  CompiledTheme,
  OfficialAppearanceVerification,
  RuntimeThemeAdapter,
} from "./types.js";

const ADAPTER_ID = "current-2026-07";
const CONTROLLED_IMAGE_DATA_URL =
  /^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function assertControlledImageDataUrls(theme: CompiledTheme): void {
  if (!CONTROLLED_IMAGE_DATA_URL.test(theme.backgroundDataUrl) ||
    theme.decorations.some((decoration) =>
      decoration.dataUrl !== undefined && !CONTROLLED_IMAGE_DATA_URL.test(decoration.dataUrl)
    )) {
    throw new RuntimeThemeError("THEME_APPLY_FAILED", "compiled image data URL is invalid");
  }
}

export function isAllowedCodexUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "app:" ||
      (url.protocol === "https:" &&
        url.hostname === "chatgpt.com" &&
        (url.pathname === "/codex" || url.pathname.startsWith("/codex/")));
  } catch {
    return false;
  }
}

export class CurrentCodexAdapter implements RuntimeThemeAdapter {
  constructor(private readonly client: CdpRuntimeClient) {}

  async probe(): Promise<AdapterProbe> {
    const location = await this.client.evaluate<string>("window.location.href");
    const capabilities = await this.client.evaluate<Record<string, boolean>>(PROBE_EXPRESSION);
    const missing = Object.entries(capabilities)
      .filter(([, present]) => !present)
      .map(([name]) => name);
    if (!isAllowedCodexUrl(location)) missing.unshift("allowed-url");
    return {
      adapterId: ADAPTER_ID,
      compatible: missing.length === 0,
      missing,
    };
  }

  async apply(theme: CompiledTheme): Promise<void> {
    assertControlledImageDataUrls(theme);
    const probe = await this.probe();
    if (!probe.compatible) {
      throw new RuntimeThemeError("ADAPTER_INCOMPATIBLE", probe.missing.join(", "));
    }

    try {
      const applied = await this.client.evaluate<boolean>(applyExpression(theme));
      if (applied !== true) throw new Error("theme apply did not report success");
    } catch (error) {
      await this.removeCandidateMarkers();
      throw new RuntimeThemeError(
        "THEME_APPLY_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }

    const verification = await this.verify();
    if (!verification.valid) {
      await this.remove();
      throw new RuntimeThemeError("THEME_VERIFY_FAILED", JSON.stringify(verification));
    }
  }

  async verify(): Promise<AdapterVerification> {
    const result = await this.client.evaluate<Omit<AdapterVerification, "valid">>(
      VERIFY_EXPRESSION,
    );
    return {
      ...result,
      valid: result.themeMarkers === 1 &&
        result.fontMarkers <= 1 &&
        result.decorationMarkers === 1 &&
        result.backgroundReady &&
        result.decorationPointerEvents === "none" &&
        result.surfaceMarkers >= 3 &&
        result.mainSurfaceReady &&
        result.sidebarSurfaceReady &&
        result.composerSurfaceReady &&
        result.composerWithinViewport &&
        !result.horizontalOverflow &&
        result.mainVisible &&
        result.composerVisible &&
        result.reviewShadowReady,
    };
  }

  async verifyOfficialAppearance(): Promise<OfficialAppearanceVerification> {
    const result = await this.client.evaluate<Omit<OfficialAppearanceVerification, "valid">>(
      VERIFY_OFFICIAL_EXPRESSION,
    );
    return {
      ...result,
      valid: result.managedMarkers === 0 &&
        !result.horizontalOverflow &&
        result.mainVisible &&
        result.navigationVisible &&
        result.composerVisible,
    };
  }

  async remove(): Promise<void> {
    await this.removeCandidateMarkers();
    const official = await this.verifyOfficialAppearance();
    if (!official.valid) {
      throw new RuntimeThemeError(
        "THEME_CLEANUP_FAILED",
        JSON.stringify({
          managedMarkers: official.managedMarkers,
          horizontalOverflow: official.horizontalOverflow,
          mainVisible: official.mainVisible,
          navigationVisible: official.navigationVisible,
          composerVisible: official.composerVisible,
        }),
      );
    }
  }

  private async removeCandidateMarkers(): Promise<void> {
    const remaining = await this.client.evaluate<number>(REMOVE_EXPRESSION);
    if (remaining !== 0) {
      throw new RuntimeThemeError("THEME_CLEANUP_FAILED", `${remaining} markers remain`);
    }
  }
}

export interface WaitForCompatibleAdapterOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export async function waitForCompatibleAdapter(
  adapter: RuntimeThemeAdapter,
  options: WaitForCompatibleAdapterOptions = {},
): Promise<AdapterProbe> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 100;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
    !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 1_000) {
    throw new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "adapter wait bounds are invalid");
  }
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const probe = await adapter.probe();
    if (probe.compatible) return probe;
    if (probe.missing.includes("allowed-url") || Date.now() >= deadline) {
      throw new RuntimeThemeError("ADAPTER_INCOMPATIBLE", probe.missing.join(", "));
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
}
