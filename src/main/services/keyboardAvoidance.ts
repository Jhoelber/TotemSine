import { BrowserWindow, WebContents, ipcMain, screen, webContents } from "electron";
import { join } from "path";

const DETECTOR_FLAG = "__LPX_ELECTRON_KEYBOARD_DETECTOR_REGISTERED__" as const;
const LAST_INJECTED_URL_FLAG = "__LPX_LAST_KEYBOARD_DETECTOR_URL__" as const;

const SHOW_CHANNEL = "totem-keyboard-show";
const HIDE_CHANNEL = "totem-keyboard-hide";
const ACTION_CHANNEL = "totem-keyboard-action";
const RESET_CHANNEL = "totem-keyboard-reset";

const KEYBOARD_HEIGHT = 392;

let keyboardWindow: BrowserWindow | null = null;
let keyboardIpcRegistered = false;
let currentTargetId = 0;
let currentOwnerWindow: BrowserWindow | null = null;
let currentOwnerSync: (() => void) | null = null;
let keyboardVisible = false;

function isGovUnstableUrl(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (hostname !== "sso.acesso.gov.br" && hostname !== "acesso.gov.br") return false;
    return pathname.includes("/login") || pathname.includes("/authorize") || pathname.includes("/logout");
  } catch {
    return false;
  }
}

function getOwnerWindow(contents: WebContents) {
  return BrowserWindow.fromWebContents(contents) ?? null;
}

function isGovUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "sso.acesso.gov.br" || hostname === "acesso.gov.br";
  } catch {
    return false;
  }
}

function positionKeyboardWindow(owner: BrowserWindow) {
  if (!keyboardWindow || keyboardWindow.isDestroyed() || owner.isDestroyed()) return;
  const bounds = screen.getDisplayMatching(owner.getBounds()).bounds;
  keyboardWindow.setBounds({
    x: bounds.x,
    y: bounds.y + bounds.height - KEYBOARD_HEIGHT,
    width: bounds.width,
    height: KEYBOARD_HEIGHT,
  });
  keyboardWindow.setAlwaysOnTop(true, "screen-saver");
}

function unbindOwnerWindow() {
  if (!currentOwnerWindow || !currentOwnerSync) return;
  currentOwnerWindow.off("move", currentOwnerSync);
  currentOwnerWindow.off("resize", currentOwnerSync);
  currentOwnerWindow.off("show", currentOwnerSync);
  currentOwnerWindow.off("restore", currentOwnerSync);
  currentOwnerWindow.off("closed", currentOwnerSync);
  currentOwnerWindow = null;
  currentOwnerSync = null;
}

function bindOwnerWindow(owner: BrowserWindow) {
  if (currentOwnerWindow === owner) return;
  unbindOwnerWindow();
  currentOwnerWindow = owner;
  currentOwnerSync = () => {
    if (!owner.isDestroyed()) {
      positionKeyboardWindow(owner);
    }
  };
  owner.on("move", currentOwnerSync);
  owner.on("resize", currentOwnerSync);
  owner.on("show", currentOwnerSync);
  owner.on("restore", currentOwnerSync);
  owner.on("closed", currentOwnerSync);
}

function getKeyboardRouteUrl() {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    return `${devServerUrl.replace(/\/$/, "")}/#/keyboard`;
  }

  return null;
}

function getKeyboardRouteFile() {
  return join(__dirname, "../renderer/index.html");
}

function createKeyboardWindow() {
  if (keyboardWindow && !keyboardWindow.isDestroyed()) return keyboardWindow;

  keyboardWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: false,
    fullscreen: false,
    kiosk: false,
    movable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: "#123d63",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  keyboardWindow.on("closed", () => {
    keyboardWindow = null;
    currentTargetId = 0;
    keyboardVisible = false;
    unbindOwnerWindow();
  });

  keyboardWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log("[keyboard-window] console", { level, message, line, sourceId });
  });

  keyboardWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error("[keyboard-window] did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });

  keyboardWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[keyboard-window] render-process-gone", details);
  });

  const keyboardRouteUrl = getKeyboardRouteUrl();
  if (keyboardRouteUrl) {
    void keyboardWindow.loadURL(keyboardRouteUrl);
  } else {
    void keyboardWindow.loadFile(getKeyboardRouteFile(), { hash: "/keyboard" });
  }

  return keyboardWindow;
}

function showKeyboardForContents(contents: WebContents) {
  const owner = getOwnerWindow(contents);
  if (!owner || owner.isDestroyed()) return;

  if (
    currentTargetId === contents.id &&
    keyboardVisible &&
    keyboardWindow &&
    !keyboardWindow.isDestroyed() &&
    keyboardWindow.isVisible()
  ) {
    positionKeyboardWindow(owner);
    return;
  }

  currentTargetId = contents.id;
  bindOwnerWindow(owner);

  const win = createKeyboardWindow();
  positionKeyboardWindow(owner);
  console.log("[keyboard-main] teclado solicitado", {
    ownerWindowId: owner.id,
    targetWebContentsId: contents.id,
    targetUrl: contents.getURL(),
  });
  owner.focus();
  win.showInactive();
  keyboardVisible = true;
  win.setAlwaysOnTop(true, "screen-saver");
  win.moveTop();
  win.webContents.send(RESET_CHANNEL);
}

function hideKeyboard() {
  if (currentTargetId) {
    console.log("[keyboard-main] teclado escondido", { targetWebContentsId: currentTargetId });
  }
  currentTargetId = 0;
  keyboardVisible = false;
  if (keyboardWindow && !keyboardWindow.isDestroyed()) {
    keyboardWindow.hide();
  }
}

function getTargetContents() {
  if (!currentTargetId) return null;
  return webContents.fromId(currentTargetId) ?? null;
}

async function runTargetAction(target: WebContents, action: { kind: string; text?: string }) {
  const payload = JSON.stringify(action);
  const result = await target.executeJavaScript(
    `
      (async () => {
        const helper = window.__LPX_ELECTRON_KEYBOARD_HELPER__;
        if (!helper || typeof helper.applyAction !== "function") {
          return { ok: false, reason: "helper-missing" };
        }
        return await helper.applyAction(${payload});
      })();
    `,
    true
  );

  return result as { ok?: boolean };
}

async function fallbackTargetAction(target: WebContents, action: { kind: string; text?: string }) {
  try {
    target.focus();
    if (action.kind === "text" && action.text) {
      await target.insertText(action.text);
      return { ok: true };
    }
    if (action.kind === "backspace") {
      target.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
      target.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
      return { ok: true };
    }
    if (action.kind === "enter") {
      target.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      target.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      return { ok: true };
    }
  } catch {
    return { ok: false };
  }
  return { ok: false };
}

async function applyKeyboardAction(action: { kind: string; text?: string }) {
  if (action.kind === "hide") {
    const target = getTargetContents();
    if (target && !target.isDestroyed()) {
      try {
        await target.executeJavaScript(
          `window.__LPX_ELECTRON_KEYBOARD_HELPER__ && window.__LPX_ELECTRON_KEYBOARD_HELPER__.dismiss && window.__LPX_ELECTRON_KEYBOARD_HELPER__.dismiss();`,
          true
        );
      } catch {
        // noop
      }
    }
    hideKeyboard();
    return { success: true };
  }

  const target = getTargetContents();
  if (!target || target.isDestroyed()) return { success: false };

  if (isGovUrl(target.getURL())) {
    if (action.kind === "enter") {
      return { success: true };
    }
    const fallback = await fallbackTargetAction(target, action);
    return { success: !!fallback.ok };
  }

  try {
    const result = await runTargetAction(target, action);
    if (result?.ok) return { success: true };
  } catch {
    // fallback below
  }

  const fallback = await fallbackTargetAction(target, action);
  return { success: !!fallback.ok };
}

function registerKeyboardIpc() {
  if (keyboardIpcRegistered) return;
  keyboardIpcRegistered = true;

  ipcMain.handle(SHOW_CHANNEL, async (event) => {
    showKeyboardForContents(event.sender);
    return { success: true };
  });

  ipcMain.handle(HIDE_CHANNEL, async (event) => {
    if (event.sender.id === currentTargetId) {
      hideKeyboard();
    }
    return { success: true };
  });

  ipcMain.handle(ACTION_CHANNEL, async (_event, action: { kind: string; text?: string }) => {
    return applyKeyboardAction(action);
  });
}

const DETECTOR_SCRIPT = `
  (() => {
    if (window.__LPX_ELECTRON_KEYBOARD_HELPER__) return;

    const keyboardHeight = ${KEYBOARD_HEIGHT};
    const isGovHost = location.hostname === "sso.acesso.gov.br" || location.hostname === "acesso.gov.br";
    let activeField = null;
    let lastEditableField = null;
    let keyboardVisible = false;
    let layoutCaptured = false;
    let originalBodyPaddingBottom = "";
    let originalHtmlScrollPaddingBottom = "";
    let originalScrollBehavior = "";

    function isEditable(el) {
      if (!(el instanceof HTMLElement)) return false;

      if (el instanceof HTMLInputElement) {
        return !el.readOnly && !el.disabled && ["text","search","email","url","tel","password","number"].includes(el.type);
      }

      if (el instanceof HTMLTextAreaElement) {
        return !el.readOnly && !el.disabled;
      }

      return el.isContentEditable;
    }

    function isActionable(el) {
      if (!(el instanceof HTMLElement)) return false;
      return Boolean(
        el.closest(
          'button, [role="button"], a[href], input[type="submit"], input[type="button"], .br-button, [data-testid="continue-button"]'
        )
      );
    }

    function resolveField() {
      const current = document.activeElement;
      if (isEditable(current)) {
        activeField = current;
        lastEditableField = current;
        return current;
      }
      if (lastEditableField && document.contains(lastEditableField) && isEditable(lastEditableField)) {
        return lastEditableField;
      }
      return null;
    }

    function captureLayoutState() {
      if (layoutCaptured || !document.body || !document.documentElement) return;
      originalBodyPaddingBottom = document.body.style.paddingBottom || "";
      originalHtmlScrollPaddingBottom = document.documentElement.style.scrollPaddingBottom || "";
      originalScrollBehavior = document.documentElement.style.scrollBehavior || "";
      layoutCaptured = true;
    }

    function restoreLayoutState() {
      if (!layoutCaptured || !document.body || !document.documentElement) return;
      document.body.style.paddingBottom = originalBodyPaddingBottom;
      document.documentElement.style.scrollPaddingBottom = originalHtmlScrollPaddingBottom;
      document.documentElement.style.scrollBehavior = originalScrollBehavior;
      layoutCaptured = false;
    }

    function keepFieldVisible() {
      if (!keyboardVisible) return;
      const field = resolveField();
      if (!field) return;
      try {
        field.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      } catch {}
      const rect = field.getBoundingClientRect();
      const safeBottom = window.innerHeight - keyboardHeight - 28;
      if (rect.bottom > safeBottom) {
        const delta = rect.bottom - safeBottom;
        window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      } else if (rect.top < 20) {
        const delta = rect.top - 20;
        window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      }
    }

    async function showKeyboard() {
      if (!window.totem || typeof window.totem.keyboardShow !== "function") return;
      keyboardVisible = true;
      if (!isGovHost) {
        captureLayoutState();
        if (document.body) {
          document.body.style.paddingBottom = (keyboardHeight + 24) + "px";
        }
        if (document.documentElement) {
          document.documentElement.style.scrollPaddingBottom = (keyboardHeight + 24) + "px";
          document.documentElement.style.scrollBehavior = "auto";
        }
      }
      await window.totem.keyboardShow();
      keepFieldVisible();
    }

    async function hideKeyboard() {
      if (!window.totem || typeof window.totem.keyboardHide !== "function") return;
      keyboardVisible = false;
      if (!isGovHost) {
        restoreLayoutState();
      }
      await window.totem.keyboardHide();
    }

    function dispatchKeyboardEvent(el, type, key) {
      try {
        return el.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
      } catch {
        return true;
      }
    }

    function dispatchBeforeInputEvent(el, inputType, data) {
      try {
        const evt = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType,
          data
        });
        return el.dispatchEvent(evt);
      } catch {
        return true;
      }
    }

    function dispatchInputEvent(el, inputType, data) {
      try {
        el.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType,
          data
        }));
      } catch {}
    }

    function insertText(el, text) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        dispatchKeyboardEvent(el, "keydown", text);
        dispatchBeforeInputEvent(el, "insertText", text);
        const start = el.selectionStart == null ? el.value.length : el.selectionStart;
        const end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
        try {
          el.setRangeText(text, start, end, "end");
        } catch {
          const nextValue = el.value.slice(0, start) + text + el.value.slice(end);
          el.value = nextValue;
          try {
            const caret = start + text.length;
            el.setSelectionRange(caret, caret);
          } catch {}
        }
        dispatchInputEvent(el, "insertText", text);
        dispatchKeyboardEvent(el, "keyup", text);
        try {
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {}
        return true;
      }

      if (el && el.isContentEditable) {
        el.focus();
        try {
          document.execCommand("insertText", false, text);
        } catch {}
        return true;
      }

      return false;
    }

    function removeText(el) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        dispatchKeyboardEvent(el, "keydown", "Backspace");
        dispatchBeforeInputEvent(el, "deleteContentBackward", null);
        const start = el.selectionStart == null ? el.value.length : el.selectionStart;
        const end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
        try {
          if (start !== end) {
            el.setRangeText("", start, end, "end");
          } else if (start > 0) {
            el.setRangeText("", start - 1, start, "end");
          }
        } catch {
          if (start !== end) {
            el.value = el.value.slice(0, start) + el.value.slice(end);
            try { el.setSelectionRange(start, start); } catch {}
          } else if (start > 0) {
            el.value = el.value.slice(0, start - 1) + el.value.slice(end);
            try { el.setSelectionRange(start - 1, start - 1); } catch {}
          }
        }
        dispatchInputEvent(el, "deleteContentBackward", null);
        dispatchKeyboardEvent(el, "keyup", "Backspace");
        try {
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {}
        return true;
      }

      if (el && el.isContentEditable) {
        el.focus();
        try {
          document.execCommand("delete", false);
        } catch {}
        return true;
      }

      return false;
    }

    function clickGovPrimaryAction(el) {
      const selectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button[data-testid="continue-button"]',
        '[data-testid="continue-button"]',
        '#enter-account-id',
        '.br-button.is-primary',
        '.br-button.primary',
        'button.br-button'
      ];

      for (const selector of selectors) {
        const candidate = document.querySelector(selector);
        if (!(candidate instanceof HTMLElement)) continue;
        if (candidate.hasAttribute("disabled")) continue;
        candidate.click();
        return true;
      }

      const nearbyButton =
        el instanceof HTMLElement
          ? el.closest("form")?.querySelector('button, input[type="submit"]')
          : null;

      if (nearbyButton instanceof HTMLElement && !nearbyButton.hasAttribute("disabled")) {
        nearbyButton.click();
        return true;
      }

      return false;
    }

    function submitField(el) {
      if (isGovHost) {
        return clickGovPrimaryAction(el);
      }

      if (el instanceof HTMLElement) {
        dispatchKeyboardEvent(el, "keydown", "Enter");
        dispatchKeyboardEvent(el, "keyup", "Enter");
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const form = el.form;
          if (form) {
            try {
              if (typeof form.requestSubmit === "function") {
                form.requestSubmit();
              } else {
                form.submit();
              }
            } catch {}
          }
        }
        return true;
      }
      return false;
    }

    window.__LPX_ELECTRON_KEYBOARD_HELPER__ = {
      async applyAction(action) {
        const field = resolveField();
        if (!field) return { ok: false, reason: "no-field" };

        field.focus();
        activeField = field;
        lastEditableField = field;

        if (action.kind === "text") {
          return { ok: insertText(field, String(action.text || "")) };
        }

        if (action.kind === "backspace") {
          return { ok: removeText(field) };
        }

        if (action.kind === "enter") {
          return { ok: submitField(field) };
        }

        if (action.kind === "hide") {
          if (field instanceof HTMLElement) field.blur();
          await hideKeyboard();
          return { ok: true };
        }

        return { ok: false, reason: "unknown-action" };
      },
      dismiss: hideKeyboard
    };

    document.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!isEditable(target)) return;
      activeField = target;
      lastEditableField = target;
    }, true);

    document.addEventListener("pointerup", (event) => {
      const target = event.target;
      if (!isEditable(target)) return;
      activeField = target;
      lastEditableField = target;
      void showKeyboard();
      keepFieldVisible();
    }, true);

    document.addEventListener("mouseup", (event) => {
      const target = event.target;
      if (!isEditable(target)) return;
      activeField = target;
      lastEditableField = target;
      void showKeyboard();
      keepFieldVisible();
    }, true);

    document.addEventListener("touchend", (event) => {
      const target = event.target;
      if (!isEditable(target)) return;
      activeField = target;
      lastEditableField = target;
      void showKeyboard();
      keepFieldVisible();
    }, true);

    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (isEditable(target)) return;
      if (isActionable(target)) {
        activeField = null;
        if (document.activeElement instanceof HTMLElement && isEditable(document.activeElement)) {
          document.activeElement.blur();
        }
        void hideKeyboard();
        return;
      }
      setTimeout(() => {
        if (!isEditable(document.activeElement)) {
          activeField = null;
          void hideKeyboard();
        }
      }, 40);
    }, true);

    window.addEventListener("resize", keepFieldVisible);
    window.addEventListener("scroll", keepFieldVisible, true);

    const initialActive = document.activeElement;
    if (isEditable(initialActive)) {
      activeField = initialActive;
      lastEditableField = initialActive;
    }
  })();
`;

async function injectDetector(mainWindow: BrowserWindow) {
  try {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;

    const currentUrl = mainWindow.webContents.getURL();
    if (!currentUrl || currentUrl === "about:blank") return;
    if (isGovUnstableUrl(currentUrl)) return;

    const wc = mainWindow.webContents as unknown as Record<string, string>;
    if (wc[LAST_INJECTED_URL_FLAG] === currentUrl) return;
    wc[LAST_INJECTED_URL_FLAG] = currentUrl;

    const frames = mainWindow.webContents.mainFrame.framesInSubtree;
    const results = await Promise.allSettled(frames.map((frame) => frame.executeJavaScript(DETECTOR_SCRIPT, true)));

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        console.log("[keyboard-inject] frame ok", index);
      } else {
        console.error("[keyboard-inject] frame fail", index, result.reason);
      }
    });
  } catch {
    // nunca fatal
  }
}

export function registerKeyboardAvoidance(mainWindow: BrowserWindow) {
  registerKeyboardIpc();

  const wc = mainWindow.webContents as unknown as Record<string, unknown>;
  if (wc[DETECTOR_FLAG]) return;
  wc[DETECTOR_FLAG] = true;
  wc[LAST_INJECTED_URL_FLAG] = "";

  const resetInjectionState = () => {
    wc[LAST_INJECTED_URL_FLAG] = "";
  };

  const patch = () => {
    void injectDetector(mainWindow);
  };

  mainWindow.on("closed", () => {
    if (currentOwnerWindow === mainWindow) {
      hideKeyboard();
      unbindOwnerWindow();
    }
  });

  mainWindow.webContents.on("did-start-loading", resetInjectionState);
  mainWindow.webContents.on("dom-ready", patch);
  mainWindow.webContents.on("did-finish-load", patch);
  mainWindow.webContents.on("did-navigate", patch);
  mainWindow.webContents.on("did-navigate-in-page", patch);

  patch();
  createKeyboardWindow();
}
