import type { BrowserWindow } from "electron";
import { app } from "electron";
import log from "electron-log";
import { autoUpdater } from "electron-updater";
import { START_URL } from "../config/constants";

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const INSTALL_DELAY_MS = 30 * 1000;

let initialized = false;
let pendingInstall = false;
let installTimer: NodeJS.Timeout | null = null;

function clearInstallTimer() {
  if (installTimer) {
    clearTimeout(installTimer);
    installTimer = null;
  }
}

function isAtHome(win: BrowserWindow) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
  return win.webContents.getURL() === START_URL;
}

function scheduleInstall(win: BrowserWindow, reason: string) {
  clearInstallTimer();

  if (!pendingInstall || !isAtHome(win)) return;

  log.info(`[updater] update downloaded; scheduling silent install (${reason})`);

  installTimer = setTimeout(() => {
    if (!pendingInstall) {
      clearInstallTimer();
      return;
    }

    if (!isAtHome(win)) {
      clearInstallTimer();
      return;
    }

    try {
      log.info("[updater] quitAndInstall(silent=true)");
      autoUpdater.quitAndInstall(true, true);
    } catch (error) {
      clearInstallTimer();
      log.error("[updater] failed to install update:", error);
    }
  }, INSTALL_DELAY_MS);
}

export function registerAutoUpdates(mainWindow: BrowserWindow) {
  if (initialized || !app.isPackaged) return;
  initialized = true;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] checking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    log.info(`[updater] update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info(`[updater] no updates available (current=${app.getVersion()}, latest=${info.version})`);
  });

  autoUpdater.on("error", (error) => {
    log.error("[updater] error:", error);
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info(
      `[updater] download ${Math.round(progress.percent)}% (${Math.round(progress.bytesPerSecond / 1024)} KB/s)`
    );
  });

  autoUpdater.on("update-downloaded", (info) => {
    pendingInstall = true;
    log.info(`[updater] update downloaded: ${info.version}`);
    scheduleInstall(mainWindow, "downloaded");
  });

  mainWindow.webContents.on("did-finish-load", () => {
    scheduleInstall(mainWindow, "did-finish-load");
  });

  mainWindow.webContents.on("did-navigate", () => {
    scheduleInstall(mainWindow, "did-navigate");
  });

  mainWindow.on("focus", () => {
    scheduleInstall(mainWindow, "focus");
  });

  mainWindow.webContents.on("before-input-event", () => {
    if (!pendingInstall) return;
    if (isAtHome(mainWindow)) {
      scheduleInstall(mainWindow, "home-interaction-reset");
    } else {
      clearInstallTimer();
    }
  });

  mainWindow.on("closed", clearInstallTimer);

  const runCheck = () => {
    void autoUpdater.checkForUpdates().catch((error) => {
      log.error("[updater] checkForUpdates failed:", error);
    });
  };

  runCheck();
  setInterval(runCheck, UPDATE_CHECK_INTERVAL_MS);
}
