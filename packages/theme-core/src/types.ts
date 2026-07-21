import type { ThemeDocument } from "@open-chatgpt-skin/theme-schema";

export type ThemeFileTable = ReadonlyMap<string, Uint8Array>;

export interface ValidatedThemeBundle {
  readonly theme: ThemeDocument;
  readonly files: ThemeFileTable;
  readonly totalBytes: number;
}
