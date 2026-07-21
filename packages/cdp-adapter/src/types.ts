export interface CompiledDecoration {
  readonly kind:
    | "particles"
    | "sparkles"
    | "ribbon"
    | "butterflies"
    | "polaroid"
    | "badge"
    | "image";
  readonly count: number;
  readonly opacity: number;
  readonly scale: number;
  readonly placement: "background" | "corners" | "hero" | "cards";
  readonly dataUrl?: string;
}

export interface CompiledTheme {
  readonly themeId: string;
  readonly themeVersion: string;
  readonly backgroundDataUrl: string;
  readonly themeCss: string;
  readonly fontCss: string;
  readonly layout: ThemeLayout;
  readonly decorations: readonly CompiledDecoration[];
  readonly totalBytes: number;
}

export interface CdpRuntimeClient {
  evaluate<T>(expression: string): Promise<T>;
}

export interface CdpEndpoint {
  readonly host: "127.0.0.1";
  readonly port: number;
}

export interface CdpTarget {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

export interface AdapterProbe {
  readonly adapterId: string;
  readonly compatible: boolean;
  readonly missing: readonly string[];
}

export interface AdapterVerification {
  readonly valid: boolean;
  readonly backgroundReady: boolean;
  readonly themeMarkers: number;
  readonly fontMarkers: number;
  readonly decorationMarkers: number;
  readonly decorationPointerEvents: string | null;
  readonly surfaceMarkers: number;
  readonly mainSurfaceReady: boolean;
  readonly sidebarSurfaceReady: boolean;
  readonly composerSurfaceReady: boolean;
  readonly composerWithinViewport: boolean;
  readonly horizontalOverflow: boolean;
  readonly mainVisible: boolean;
  readonly composerVisible: boolean;
  readonly reviewShadowReady: boolean;
}

export interface OfficialAppearanceVerification {
  readonly valid: boolean;
  readonly managedMarkers: number;
  readonly horizontalOverflow: boolean;
  readonly mainVisible: boolean;
  readonly navigationVisible: boolean;
  readonly composerVisible: boolean;
}

export interface RuntimeThemeAdapter {
  probe(): Promise<AdapterProbe>;
  apply(theme: CompiledTheme): Promise<void>;
  verify(): Promise<AdapterVerification>;
  verifyOfficialAppearance(): Promise<OfficialAppearanceVerification>;
  remove(): Promise<void>;
}
import type { ThemeLayout } from "@open-chatgpt-skin/theme-schema";
