import type { BrowserWindow } from "electron";
import { START_URL } from "../config/constants";

const LOAD_TIMEOUT_MS = 30000;

export function registerWatchdog(mainWindow: BrowserWindow) {
  let loadTimer: NodeJS.Timeout | null = null;

  function clearLoadTimer() {
    if (loadTimer) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }
  }

  function recoverToStart(reason: string) {
    clearLoadTimer();

    try {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      console.error("[watchdog] recovering to start:", reason, mainWindow.webContents.getURL());
      void mainWindow.loadURL(START_URL).catch((error) => {
        console.error("[watchdog] failed to recover:", error);
      });
    } catch (error) {
      console.error("[watchdog] unexpected recovery error:", error);
    }
  }

  function armLoadTimer() {
    clearLoadTimer();

    loadTimer = setTimeout(() => {
      recoverToStart("load-timeout");
    }, LOAD_TIMEOUT_MS);
  }

  mainWindow.webContents.on("did-start-loading", () => {
    const currentUrl = mainWindow.webContents.getURL();
    if (!currentUrl || currentUrl === START_URL) return;
    armLoadTimer();
  });

  mainWindow.webContents.on("did-stop-loading", clearLoadTimer);
  mainWindow.webContents.on("did-finish-load", clearLoadTimer);

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return;
    recoverToStart(`did-fail-load:${errorCode}:${errorDescription}:${validatedURL}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    recoverToStart(`render-process-gone:${details.reason}`);
  });

  mainWindow.on("unresponsive", () => {
    recoverToStart("window-unresponsive");
  });

  mainWindow.on("closed", clearLoadTimer);
}