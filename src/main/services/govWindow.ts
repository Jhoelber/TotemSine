import { BrowserWindow, ipcMain, screen } from "electron";
import { join } from "path";
import { START_URL } from "../config/constants";
import { registerKeyboardAvoidance } from "./keyboardAvoidance";

const GOV_HOSTS = new Set(["servicos.mte.gov.br", "sso.acesso.gov.br", "acesso.gov.br"]);
const GOV_LOGIN_URL = "https://servicos.mte.gov.br/spme-v2/#/login";
const TOP_BAR_HEIGHT = 60;
const CONTROL_BACK_CHANNEL = "lpx-gov-control-back";
const CONTROL_CLOSE_CHANNEL = "lpx-gov-control-close";
const GOV_AUTH_SAME_URL_RETRY_LIMIT = 1;
const GOV_AUTH_SAME_URL_RETRY_WINDOW_MS = 45000;

let parentWindowRef: BrowserWindow | null = null;
let govShellWindow: BrowserWindow | null = null;
let govContentWindow: BrowserWindow | null = null;
let controlsIpcRegistered = false;
let govPartition = "";
let lastGovUrl = GOV_LOGIN_URL;
let recovering = false;
let govShellReady = false;
let govContentReady = false;
let lastGovOpenUrl = "";
let lastGovOpenAt = 0;
let lastGovAuthCrashKey = "";
let lastGovAuthCrashAt = 0;
let lastGovAuthCrashCount = 0;

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

function isGovAuthUrl(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    return (
      (hostname === "sso.acesso.gov.br" || hostname === "acesso.gov.br") &&
      (pathname.includes("/login") || pathname.includes("/authorize") || pathname.includes("/logout"))
    );
  } catch {
    return false;
  }
}

function getGovAuthCrashKey(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (hostname === "sso.acesso.gov.br" || hostname === "acesso.gov.br") {
      return `${hostname}${pathname}`;
    }

    return url;
  } catch {
    return url;
  }
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

function buildGovLoadingHtml() {
  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: linear-gradient(180deg, #f8fafc 0%, #eef6ff 100%);
            font-family: Arial, sans-serif;
          }

          body {
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .wrap {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 18px;
            color: #0f172a;
            text-align: center;
            padding: 24px;
          }

          .spinner {
            width: 58px;
            height: 58px;
            border-radius: 999px;
            border: 6px solid #dbeafe;
            border-top-color: #2563eb;
            animation: spin 0.9s linear infinite;
          }

          .title {
            font-size: 28px;
            font-weight: 700;
            letter-spacing: 0.01em;
          }

          .subtitle {
            font-size: 18px;
            color: #475569;
            max-width: 520px;
            line-height: 1.45;
          }

          @keyframes spin {
            to {
              transform: rotate(360deg);
            }
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="spinner"></div>
          <div class="title">Abrindo Carteira de Trabalho Digital</div>
          <div class="subtitle">Aguarde alguns instantes enquanto carregamos o portal oficial.</div>
        </div>
      </body>
    </html>
  `;
}

function buildGovStatusHtml(message: string, detail: string, retryUrl?: string) {
  const escapeHtml = (value: string) =>
    String(value || "").replace(/[&<>"']/g, (char) => {
      const map: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };

      return map[char] || char;
    });

  const safeMessage = escapeHtml(message);
  const safeDetail = escapeHtml(detail);
  const safeRetryUrl = retryUrl ? JSON.stringify(String(retryUrl)) : "";

  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: linear-gradient(180deg, #f8fafc 0%, #eef6ff 100%);
            font-family: Arial, sans-serif;
          }

          body {
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .wrap {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            text-align: center;
            padding: 24px;
            max-width: 640px;
          }

          .title {
            font-size: 28px;
            font-weight: 700;
            color: #0f172a;
          }

          .detail {
            font-size: 18px;
            color: #475569;
            line-height: 1.45;
          }

          .retry {
            margin-top: 8px;
            padding: 12px 22px;
            border: 0;
            border-radius: 12px;
            background: #2563eb;
            color: #ffffff;
            font-size: 18px;
            font-weight: 700;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="title">${safeMessage}</div>
          <div class="detail">${safeDetail}</div>
          ${
            retryUrl
              ? `<button class="retry" id="retry-gov">Tentar novamente</button>`
              : ""
          }
        </div>
        ${
          retryUrl
            ? `<script>
                document.getElementById("retry-gov")?.addEventListener("click", () => {
                  window.location.replace(${safeRetryUrl});
                });
              </script>`
            : ""
        }
      </body>
    </html>
  `;
}

function showGovStatus(message: string, detail = "Aguarde alguns instantes.") {
  if (!govContentWindow || govContentWindow.isDestroyed()) return;

  void govContentWindow
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildGovStatusHtml(message, detail))}`)
    .catch(() => {});
}

function showGovRetryStatus(message: string, detail: string, retryUrl: string) {
  if (!govContentWindow || govContentWindow.isDestroyed()) return;

  void govContentWindow
    .loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        buildGovStatusHtml(message, detail, retryUrl || GOV_LOGIN_URL)
      )}`
    )
    .catch(() => {});
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
  govShellReady = false;
  govContentReady = false;
  lastGovOpenUrl = "";
  lastGovOpenAt = 0;
  lastGovAuthCrashKey = "";
  lastGovAuthCrashAt = 0;
  lastGovAuthCrashCount = 0;
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

function finalizeGovPresentation() {
  if (!parentWindowRef || parentWindowRef.isDestroyed()) return;
  if (!govShellWindow || !govContentWindow) return;
  if (govShellWindow.isDestroyed() || govContentWindow.isDestroyed()) return;
  if (!govShellReady || !govContentReady) return;

  govShellWindow.showInactive();
  govContentWindow.show();
  enforceGovTopmost();
  parentWindowRef.hide();
  govShellWindow.focus();
  govContentWindow.focus();
}

function shouldIgnoreDuplicateGovOpen(url: string) {
  const now = Date.now();
  if (lastGovOpenUrl === url && now - lastGovOpenAt < 1500) {
    return true;
  }

  lastGovOpenUrl = url;
  lastGovOpenAt = now;
  return false;
}

function registerGovAuthCrashAttempt(url: string) {
  const key = getGovAuthCrashKey(url);
  const now = Date.now();
  if (lastGovAuthCrashKey === key && now - lastGovAuthCrashAt <= GOV_AUTH_SAME_URL_RETRY_WINDOW_MS) {
    lastGovAuthCrashCount += 1;
  } else {
    lastGovAuthCrashKey = key;
    lastGovAuthCrashAt = now;
    lastGovAuthCrashCount = 1;
  }

  return lastGovAuthCrashCount;
}

function loadGovUrl(url: string, attempt = 0) {
  if (!govContentWindow || govContentWindow.isDestroyed()) return;

  void govContentWindow.loadURL(url).catch((error: { code?: string }) => {
    console.error("[gov-window] falha ao abrir:", error);

    if (error?.code === "ERR_FAILED" && attempt < 1) {
      setTimeout(() => {
        loadGovUrl(url, attempt + 1);
      }, 300);
      return;
    }

    closeGovWindow("crash");
  });
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

  govShellWindow.once("ready-to-show", () => {
    govShellReady = true;
    finalizeGovPresentation();
  });

  govContentWindow.once("ready-to-show", () => {
    govContentReady = true;
    finalizeGovPresentation();
  });

  void govShellWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildGovShellHtml())}`);
  void govContentWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildGovLoadingHtml())}`);

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

    if (details.reason !== "crashed") {
      closeGovWindow("crash");
      return;
    }

    const crashedUrl = lastGovUrl;

    if (recovering) {
      showGovStatus(
        "Nao foi possivel abrir o login do Gov.br",
        "A tela de autenticacao apresentou instabilidade. Toque em Voltar ou tente novamente em instantes."
      );
      loadGovUrl(GOV_LOGIN_URL);
      recovering = false;
      return;
    }

    if (!isGovAuthUrl(crashedUrl)) {
      recovering = true;
      showGovStatus("Recuperando acesso", "Aguarde alguns instantes.");
      loadGovUrl(GOV_LOGIN_URL);
      recovering = false;
      return;
    }

    const crashAttempt = registerGovAuthCrashAttempt(crashedUrl);

    if (crashAttempt <= GOV_AUTH_SAME_URL_RETRY_LIMIT) {
      recovering = true;
      showGovStatus("Recuperando acesso", "O portal do Gov.br apresentou uma instabilidade. Tentando novamente.");
      setTimeout(() => {
        recovering = false;
        loadGovUrl(crashedUrl, 0);
      }, 350);
      return;
    }

    recovering = false;
    showGovRetryStatus(
      "Nao foi possivel abrir o login do Gov.br",
      "A tela de autenticacao apresentou instabilidade repetida. Toque em tentar novamente ou use Voltar para retornar ao sistema.",
      GOV_LOGIN_URL
    );
  });
}

export function openGovWindow(parentWindow: BrowserWindow, url: string) {
  parentWindowRef = parentWindow;
  lastGovUrl = url;

  if (shouldIgnoreDuplicateGovOpen(url)) {
    return govContentWindow;
  }

  ensureGovWindows(parentWindow);
  syncGovWindowBounds(parentWindow);

  if (!govShellWindow || !govContentWindow) {
    return null;
  }

  if (govShellReady && govContentReady) {
    finalizeGovPresentation();
  }

  const currentUrl = govContentWindow.webContents.getURL();
  if (currentUrl !== url) {
    loadGovUrl(url);
  }

  return govContentWindow;
}
