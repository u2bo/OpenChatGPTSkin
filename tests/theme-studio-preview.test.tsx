// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StudioDraft } from "@open-chatgpt-skin/theme-studio-core";
import { parseThemeDocument } from "@open-chatgpt-skin/theme-schema";
import { PreviewCanvas } from "../apps/theme-studio/src/editor/PreviewCanvas.js";

afterEach(cleanup);

function previewDraft(): StudioDraft {
  const theme = parseThemeDocument(JSON.parse(readFileSync(
    resolve("themes/builtin/future-idol-cyan/theme.json"),
    "utf8",
  )));
  const backgroundPath = theme.assets.background!;
  theme.assets.profileAvatar = backgroundPath;
  theme.assets.suggestionIcons = {
    card1: backgroundPath,
    card2: backgroundPath,
    card3: backgroundPath,
    card4: backgroundPath,
  };
  theme.assets.projectIcons = [backgroundPath, backgroundPath];
  theme.interfaceImages = {
    profileAvatarSize: 28,
    suggestionIconSize: 36,
    projectIconSize: 20,
  };
  return {
    draftId: "00000000-0000-4000-8000-000000000099",
    theme,
    revision: 0,
    updatedAt: "2026-07-18T02:00:00.000Z",
    savedRef: null,
    dirty: true,
    undoAvailable: false,
    redoAvailable: false,
    issues: [],
    assetUrls: {
      [backgroundPath]: "/api/draft-asset?background=authorized",
    },
  };
}

describe("Theme Studio Codex preview", () => {
  it("uses fictional sample projects instead of user screenshot data", () => {
    render(<PreviewCanvas draft={previewDraft()} />);

    expect(screen.getByText("星图编辑器")).toBeVisible();
    expect(screen.getByText("知识库助手")).toBeVisible();
    expect(screen.queryByText("DataMate")).not.toBeInTheDocument();
    expect(screen.queryByText("江铃集团AI项目")).not.toBeInTheDocument();
  });

  it("renders the selected background as a real preview image", () => {
    render(<PreviewCanvas draft={previewDraft()} />);

    expect(screen.getByRole("img", { name: "主题背景" }))
      .toHaveAttribute("src", "/api/draft-asset?background=authorized");
  });

  it("uses the shared crop model for suggestion images and the demo avatar", () => {
    render(<PreviewCanvas draft={previewDraft()} />);

    expect(screen.getByRole("img", { name: "示例用户头像" }))
      .toHaveStyle({ objectPosition: "50% 35%", width: "28px", height: "28px" });
    for (const [index, position] of [
      [1, "20% 25%"],
      [2, "80% 25%"],
      [3, "20% 75%"],
      [4, "80% 75%"],
    ] as const) {
      expect(screen.getByRole("img", { name: `建议卡片 ${index} 图片` }))
        .toHaveStyle({ objectPosition: position, width: "36px", height: "36px" });
    }
    const projectImages = document.querySelectorAll<HTMLImageElement>(".codex-project-image");
    expect(projectImages).toHaveLength(6);
    expect(projectImages[0]).toHaveStyle({ width: "20px", height: "20px" });
  });

  it("restores the existing SVG visuals when interface imagery is cleared", () => {
    const draft = previewDraft();
    delete draft.theme.assets.profileAvatar;
    delete draft.theme.assets.suggestionIcons;
    delete draft.theme.assets.projectIcons;
    render(<PreviewCanvas draft={draft} />);

    expect(screen.queryByRole("img", { name: "示例用户头像" })).not.toBeInTheDocument();
    expect(screen.getByText("示例用户").closest("footer")?.querySelector("svg"))
      .not.toBeNull();
    expect(screen.getByText("探索并理解代码").closest("button")?.querySelector("svg"))
      .not.toBeNull();
  });

  it("uses the shared welcome layout and can hide the native home icon", () => {
    const draft = previewDraft();
    draft.theme.home = {
      welcome: {
        localized: { "zh-CN": { lines: ["在「{projectName}」中，", "一起创造吧"] } },
        layout: {
          anchor: "top-left",
          positionX: 0.06,
          positionY: 0.46,
          width: 0.76,
          textAlign: "left",
          hideNativeIcon: true,
        },
      },
    };
    render(<PreviewCanvas draft={draft} />);

    const heading = screen.getByText("在「星崎皮肤实验室」中，").closest("h2");
    expect(heading).toHaveStyle({
      left: "6%",
      top: "46%",
      width: "76%",
      textAlign: "left",
    });
    expect(heading?.closest(".codex-hero")?.querySelector(":scope > svg")).toBeNull();
  });

  it("previews the task workbench with the same configurable surface model", () => {
    const draft = previewDraft();
    render(<PreviewCanvas draft={draft} mode="task" />);

    expect(screen.getByText("示例终端")).toBeVisible();
    expect(screen.getByText("2 个文件已更改")).toBeVisible();
    expect(screen.queryByText("我们应该在示例工作区中做些什么？"))
      .not.toBeInTheDocument();
    const preview = document.querySelector<HTMLElement>(".codex-preview");
    expect(preview?.style.getPropertyValue("--preview-surface-blur"))
      .toBe(`${draft.theme.surfaces.blur}px`);
    expect(preview?.style.getPropertyValue("--preview-task-background"))
      .toContain("color-mix");
  });

  it("does not add preview-only backdrop blur over the configured background", () => {
    const css = readFileSync(resolve("apps/theme-studio/src/styles.css"), "utf8");
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf("}", start) + 1);
    };

    for (const selector of [
      ".codex-window-titlebar",
      ".codex-sidebar",
      ".codex-composer",
    ]) {
      expect(rule(selector)).not.toMatch(/backdrop-filter:\s*blur\((?:18|20)px\)/);
      expect(rule(selector)).toContain("blur(var(--preview-surface-blur))");
    }
    expect(rule(".codex-main-surface")).toContain("backdrop-filter: none");
    expect(css).not.toMatch(/backdrop-filter:\s*blur\((?:12|16|18|20)px\)/);
  });

  it("uses module spacing once instead of stacking it with a home flex gap", () => {
    const css = readFileSync(resolve("apps/theme-studio/src/styles.css"), "utf8");
    const start = css.indexOf(".codex-home-content {");
    const homeRule = css.slice(start, css.indexOf("}", start) + 1);

    expect(homeRule).toContain("gap: 0");
    expect(homeRule).not.toContain("var(--preview-gap)");
  });

  it("keeps the project picker attached to the composer like Codex Desktop", () => {
    const css = readFileSync(resolve("apps/theme-studio/src/styles.css"), "utf8");
    const selector = ".codex-native-project-picker-slot";
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    const pickerStart = css.indexOf(".codex-project-picker {");
    const pickerRule = css.slice(pickerStart, css.indexOf("}", pickerStart) + 1);
    const composerSlotSelector = ".codex-bottom-stack > .codex-module-slot:has(.codex-composer)";
    const composerSlotStart = css.indexOf(`${composerSlotSelector} {`);
    const composerSlotRule = css.slice(
      composerSlotStart,
      css.indexOf("}", composerSlotStart) + 1,
    );

    expect(rule).toContain("height: 43px");
    expect(rule).toContain("margin-bottom: 0");
    expect(rule).toContain("z-index: 0");
    expect(rule).toContain("overflow: hidden");
    expect(pickerRule).toContain("min-height: 61px");
    expect(pickerRule).toContain("padding: 6px 14px 27px");
    expect(composerSlotRule).toContain("z-index: 1");
  });

  it("always uses the native project picker geometry regardless of theme layout values", () => {
    const draft = previewDraft();
    const projectPicker = draft.theme.layout.modules.find((module) =>
      module.id === "project-picker"
    )!;
    projectPicker.visible = false;
    projectPicker.size = "compact";
    projectPicker.align = "center";
    projectPicker.spacing = 48;

    render(<PreviewCanvas draft={draft} />);

    const picker = screen.getByText("示例工作区").closest(".codex-project-picker");
    expect(picker).toBeVisible();
    expect(picker).not.toHaveAttribute("data-size");
    expect(picker).not.toHaveAttribute("data-align");
    expect(picker?.closest<HTMLElement>(".codex-module-slot")?.style
      .getPropertyValue("--module-spacing")).toBe("");
  });

  it("keeps the background above the preview root paint layer", () => {
    const css = readFileSync(resolve("apps/theme-studio/src/styles.css"), "utf8");
    const backgroundRule = css.slice(
      css.indexOf(".preview-background {"),
      css.indexOf("}", css.indexOf(".preview-background {")) + 1,
    );
    const overlayRule = css.slice(
      css.indexOf(".preview-overlay {"),
      css.indexOf("}", css.indexOf(".preview-overlay {")) + 1,
    );
    expect(backgroundRule).toContain("z-index: 0");
    expect(overlayRule).toContain("z-index: 1");
  });
});
