import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeStudioApp } from "./App.js";
import {
  createHttpStudioBridge,
  establishStudioSession,
} from "./bridge/http-studio-bridge.js";
import "./styles.css";

async function start(): Promise<void> {
  const root = createRoot(document.getElementById("root")!);
  root.render(<p role="status">正在建立本地安全会话…</p>);
  try {
    const location = new URL(window.location.href);
    await establishStudioSession(
      location,
      (url) => window.history.replaceState(null, "", url),
    );
    const bridge = createHttpStudioBridge();
    const bootstrap = await bridge.bootstrap();
    root.render(
      <StrictMode>
        <ThemeStudioApp bootstrap={bootstrap} bridge={bridge} />
      </StrictMode>,
    );
  } catch {
    root.render(
      <main className="studio-fatal" role="alert">
        <h1>Theme Studio 无法启动</h1>
        <p>
          本地安全会话无效。请从 OpenChatGPTSkin 启动器重新打开 Theme Studio。
        </p>
      </main>,
    );
  }
}

void start();
