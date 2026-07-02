import { BrowserWindow, ipcMain, screen } from "electron";
import { join } from "path";
import { START_URL } from "../config/constants";
import { registerKeyboardAvoidance } from "./keyboardAvoidance";

const GOV_HOSTS = new Set(["servicos.mte.gov.br", "sso.acesso.gov.br", "acesso.gov.br"]);
const GOV_LOGIN_URL = "https://servicos.mte.gov.br/spme-v2/#/login";
const TOP_BAR_HEIGHT = 60;
const CONTROL_BACK_CHANNEL = "lpx-gov-control-back";
const CONTROL_CLOSE_CHANNEL = "lpx-gov-control-close";

let parentWindowRef: BrowserWindow | null = null;
let govShellWindow: BrowserWindow | null = null;
let govContentWindow: BrowserWindow | null = null;
let controlsIpcRegistered = false;
let govPartition = "";
let lastGovUrl = GOV_LOGIN_URL;
let recovering = false;

function enforceGovTopmost() {
  if (govShellWindow && !govShellWindow.isDestroyed()) {
    govShellWindow.setAlwaysOnTop(true, "screen-saver");
    govShellWindow.moveTop();
  }

  if (govContentWindow && !govContentWindow.isDestroyed()) {
    govContentWindow.setAlwaysOnTop(true, "screen-saver");
    govContentWindow.moveTop();
  }
}

function registerControlsIpc() {
  if (controlsIpcRegistered) return;
  controlsIpcRegistered = true;

  ipcMain.on(CONTROL_BACK_CHANNEL, () => {
    if (govContentWindow && !govContentWindow.isDestroyed() && govContentWindow.webContents.canGoBack()) {
      govContentWindow.webContents.goBack();
      return;
    }

    closeGovWindow("back");
  });

  ipcMain.on(CONTROL_CLOSE_CHANNEL, () => {
    closeGovWindow("exit");
  });
}

function getDisplayBounds(referenceWindow: BrowserWindow) {
  if (referenceWindow.isDestroyed()) {
    return screen.getPrimaryDisplay().bounds;
  }

  return screen.getDisplayMatching(referenceWindow.getBounds()).bounds;
}

function buildGovShellHtml() {
  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          :root {
            color-scheme: light;
          }

          * {
            box-sizing: border-box;
          }

          html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #ffffff;
            font-family: Arial, sans-serif;
          }

          .bar {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px;
          }

          .button {
            background-color: #eee;
            border: 0.5px solid #ccc;
            border-radius: 7px;
            color: black;
            padding: 8px 14px;
            font-size: 12px;
            cursor: pointer;
          }

          .spacer {
            flex: 1;
          }
        </style>
      </head>
      <body>
        <div class="bar">
          <button class="button" id="gov-back">Voltar</button>
          <div class="spacer"></div>
          <button class="button" id="gov-exit">Sair</button>
        </div>

        <script>
          const bind = () => {
            const back = document.getElementById("gov-back");
            const exit = document.getElementById("gov-exit");

            if (back) {
              back.addEventListener("click", () => {
                if (window.electron && window.electron.ipcRenderer) {
                  window.electron.ipcRenderer.send(${JSON.stringify(CONTROL_BACK_CHANNEL)});
                }
              });
            }

            if (exit) {
              exit.addEventListener("click", () => {
                if (window.electron && window.electron.ipcRenderer) {
                  window.electron.ipcRenderer.send(${JSON.stringify(CONTROL_CLOSE_CHANNEL)});
                }
              });
            }
          };

          bind();
        </script>
      </body>
    </html>
  `;
}

function injectGovContentStyle(windowRef: BrowserWindow) {
  if (windowRef.isDestroyed() || windowRef.webContents.isDestroyed()) return;

  void windowRef.webContents
    .executeJavaScript(
      `
        (() => {
          if (document.getElementById('lpx-gov-scrollbar-style')) return;

          const style = document.createElement('style');
          style.id = 'lpx-gov-scrollbar-style';
          style.textContent = \`
            html, body {
              scrollbar-width: none !important;
              -ms-overflow-style: none !important;
            }

            html::-webkit-scrollbar,
            body::-webkit-scrollbar,
            *::-webkit-scrollbar {
              width: 0 !important;
              height: 0 !important;
              display: none !important;
              background: transparent !important;
            }
          \`;

          document.head.appendChild(style);
        })();
      `,
      true
    )
    .catch(() => {});
}

function destroyGovWindows() {
  if (govShellWindow && !govShellWindow.isDestroyed()) {
    govShellWindow.destroy();
  }

  if (govContentWindow && !govContentWindow.isDestroyed()) {
    govContentWindow.destroy();
  }

  govShellWindow = null;
  govContentWindow = null;
  recovering = false;
  govPartition = "";
}

function showParentWithoutFlash() {
  if (!parentWindowRef || parentWindowRef.isDestroyed()) return;
  parentWindowRef.show();
  parentWindowRef.focus();
}

export function closeGovWindow(reason: "exit" | "back" | "crash" = "exit") {
  const parent = parentWindowRef;

  destroyGovWindows();
  lastGovUrl = GOV_LOGIN_URL;

  if (!parent || parent.isDestroyed()) return;

  showParentWithoutFlash();

  if (reason === "back") {
    try {
      if (parent.webContents.canGoBack()) {
        parent.webContents.goBack();
        return;
      }
    } catch {
      // noop
    }
  }

  if (reason === "exit" || reason === "crash") {
    void parent.loadURL(START_URL).catch(() => {});
  }
}

export function closeGovWindowAndReturnHome(reason: "exit" | "back" | "crash" = "exit") {
  closeGovWindow(reason);
}

export function isGovSensitiveUrl(url: string) {
  try {
    const parsed = new URL(url);
    return GOV_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function syncGovWindowBounds(parentWindow: BrowserWindow) {
  if (!govShellWindow || !govContentWindow) return;
  if (govShellWindow.isDestroyed() || govContentWindow.isDestroyed()) return;

  const bounds = getDisplayBounds(parentWindow);
  govShellWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: TOP_BAR_HEIGHT,
  });

  govContentWindow.setBounds({
    x: bounds.x,
    y: bounds.y + TOP_BAR_HEIGHT,
    width: bounds.width,
    height: Math.max(100, bounds.height - TOP_BAR_HEIGHT),
  });

  enforceGovTopmost();
}

function ensureGovWindows(parentWindow: BrowserWindow) {
  registerControlsIpc();

  if (
    govShellWindow &&
    !govShellWindow.isDestroyed() &&
    govContentWindow &&
    !govContentWindow.isDestroyed()
  ) {
    syncGovWindowBounds(parentWindow);
    return;
  }

  const bounds = getDisplayBounds(parentWindow);
  govPartition = `temp:gov-${Date.now()}`;

  govShellWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: TOP_BAR_HEIGHT,
    frame: false,
    show: false,
    fullscreen: false,
    kiosk: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: govPartition,
      devTools: false,
    },
  });

  govContentWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y + TOP_BAR_HEIGHT,
    width: bounds.width,
    height: Math.max(100, bounds.height - TOP_BAR_HEIGHT),
    frame: false,
    show: false,
    fullscreen: false,
    kiosk: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: govPartition,
      devTools: false,
    },
  });

  registerKeyboardAvoidance(govContentWindow);

  void govShellWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildGovShellHtml())}`);

  govShellWindow.on("closed", () => {
    if (govContentWindow && !govContentWindow.isDestroyed()) {
      govContentWindow.destroy();
    }
    govShellWindow = null;
    govContentWindow = null;
    recovering = false;
    showParentWithoutFlash();
  });

  govShellWindow.on("show", enforceGovTopmost);
  govShellWindow.on("focus", enforceGovTopmost);
  govShellWindow.on("restore", enforceGovTopmost);

  govContentWindow.on("closed", () => {
    if (govShellWindow && !govShellWindow.isDestroyed()) {
      govShellWindow.destroy();
    }
    govShellWindow = null;
    govContentWindow = null;
    recovering = false;
    showParentWithoutFlash();
  });

  govContentWindow.on("show", enforceGovTopmost);
  govContentWindow.on("focus", enforceGovTopmost);
  govContentWindow.on("restore", enforceGovTopmost);

  govContentWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (!govContentWindow || govContentWindow.isDestroyed()) {
      return { action: "deny" };
    }

    if (/^https?:\/\//i.test(nextUrl)) {
      lastGovUrl = nextUrl;
      void govContentWindow.loadURL(nextUrl).catch(() => {});
    }

    return { action: "deny" };
  });

  govContentWindow.webContents.on("did-navigate", (_event, nextUrl) => {
    if (isGovSensitiveUrl(nextUrl)) {
      lastGovUrl = nextUrl;
    }
  });

  govContentWindow.webContents.on("did-navigate-in-page", (_event, nextUrl) => {
    if (isGovSensitiveUrl(nextUrl)) {
      lastGovUrl = nextUrl;
    }
  });

  govContentWindow.webContents.on("did-finish-load", () => {
    injectGovContentStyle(govContentWindow as BrowserWindow);
  });

  govContentWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[gov-window] render-process-gone:", details.reason, lastGovUrl);

    if (!govContentWindow || govContentWindow.isDestroyed()) return;

    if (recovering) {
      closeGovWindow("crash");
      return;
    }

    recovering = true;
    const recoveryUrl = isGovSensitiveUrl(lastGovUrl) ? lastGovUrl : GOV_LOGIN_URL;

    void govContentWindow.loadURL(recoveryUrl).catch((error) => {
      console.error("[gov-window] falha ao recuperar:", error);
      closeGovWindow("crash");
    }).finally(() => {
      recovering = false;
    });
  });
}

export function openGovWindow(parentWindow: BrowserWindow, url: string) {
  parentWindowRef = parentWindow;
  lastGovUrl = url;

  ensureGovWindows(parentWindow);
  syncGovWindowBounds(parentWindow);

  if (!govShellWindow || !govContentWindow) {
    return null;
  }

  parentWindow.hide();

  void govContentWindow.loadURL(url).catch((error) => {
    console.error("[gov-window] falha ao abrir:", error);
    closeGovWindow("crash");
  });

  govShellWindow.showInactive();
  govShellWindow.focus();
  govContentWindow.show();
  govContentWindow.focus();
  enforceGovTopmost();

  return govContentWindow;
}
