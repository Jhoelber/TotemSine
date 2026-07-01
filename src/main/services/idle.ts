// src/main/services/idle.ts
import type { BrowserWindow } from "electron";
import { START_URL, TEMPO_INATIVIDADE_MS } from "../config/constants";
import { resetTotemSession } from "./sessionReset";

const ACTIVITY_MARKER = "__LPX_USER_ACTIVITY__";

export function registerIdle(mainWindow: BrowserWindow) {
  let timeoutID: NodeJS.Timeout | undefined;
  let started = false;

  function resetTimeout() {
    if (timeoutID) clearTimeout(timeoutID);
    timeoutID = setTimeout(() => {
      void redirecionarUsuario();
    }, TEMPO_INATIVIDADE_MS);
  }

  async function redirecionarUsuario() {
    try {
      if (mainWindow.isDestroyed()) return;
      if (mainWindow.webContents.isDestroyed()) return;
      if (mainWindow.webContents.getURL() === START_URL) return;

      await resetTotemSession(mainWindow);

      await mainWindow.loadURL(START_URL).catch((e: { code?: string }) => {
        if (e?.code === "ERR_ABORTED") return;
        console.error("Idle loadURL falhou:", e);
      });
    } catch (e) {
      console.error("Idle erro:", e);
    }
  }

  function injectActivityBridge() {
    void mainWindow.webContents
      .executeJavaScript(
        `
          (() => {
            if (window.__LPX_IDLE_ACTIVITY_BOUND__) return;
            window.__LPX_IDLE_ACTIVITY_BOUND__ = true;

            const report = () => console.debug(${JSON.stringify(ACTIVITY_MARKER)});
            window.addEventListener('pointerdown', report, true);
            window.addEventListener('touchstart', report, true);
            window.addEventListener('keydown', report, true);
            window.addEventListener('submit', report, true);
          })();
        `,
        true
      )
      .catch(() => {});
  }

  function iniciarTempoInativo() {
    if (!started) {
      started = true;

      mainWindow.on("closed", () => {
        if (timeoutID) clearTimeout(timeoutID);
        timeoutID = undefined;
      });

      mainWindow.on("focus", resetTimeout);
      mainWindow.webContents.on("before-input-event", resetTimeout);
      mainWindow.webContents.on("did-start-loading", resetTimeout);
      mainWindow.webContents.on("did-finish-load", () => {
        injectActivityBridge();
        resetTimeout();
      });
      mainWindow.webContents.on("did-navigate", resetTimeout);
      mainWindow.webContents.on("did-navigate-in-page", resetTimeout);
      mainWindow.webContents.on("console-message", (_event, _level, message) => {
        if (message === ACTIVITY_MARKER) resetTimeout();
      });
    }

    injectActivityBridge();
    resetTimeout();
  }

  return { iniciarTempoInativo };
}
