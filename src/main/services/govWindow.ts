import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { START_URL } from '../config/constants'
import { registerKeyboardAvoidance } from './keyboardAvoidance'
import { logSecurityError, logSecurityInfo, logSecurityWarn } from './securityLog'
import { SINE_BASE_CSS, SINE_COLORS, SINE_ICONS } from './sineUi'

const GOV_HOSTS = new Set(['servicos.mte.gov.br', 'sso.acesso.gov.br', 'acesso.gov.br'])
const GOV_LOGIN_URL = 'https://servicos.mte.gov.br/spme-v2/#/login'
const TOP_BAR_HEIGHT = 88
const CONTROL_BACK_CHANNEL = 'lpx-gov-control-back'
const CONTROL_CLOSE_CHANNEL = 'lpx-gov-control-close'
const GOV_AUTH_SAME_URL_RETRY_LIMIT = 1
const GOV_AUTH_SAME_URL_RETRY_WINDOW_MS = 45000

let parentWindowRef: BrowserWindow | null = null
let govShellWindow: BrowserWindow | null = null
let govContentWindow: BrowserWindow | null = null
let controlsIpcRegistered = false
let govPartition = ''
let lastGovUrl = GOV_LOGIN_URL
let recovering = false
let govShellReady = false
let govContentReady = false
let lastGovOpenUrl = ''
let lastGovOpenAt = 0
let lastGovAuthCrashKey = ''
let lastGovAuthCrashAt = 0
let lastGovAuthCrashCount = 0

function enforceGovTopmost() {
  if (govShellWindow && !govShellWindow.isDestroyed()) {
    govShellWindow.setAlwaysOnTop(true, 'screen-saver')
    govShellWindow.moveTop()
  }

  if (govContentWindow && !govContentWindow.isDestroyed()) {
    govContentWindow.setAlwaysOnTop(true, 'screen-saver')
    govContentWindow.moveTop()
  }
}

function registerControlsIpc() {
  if (controlsIpcRegistered) return
  controlsIpcRegistered = true

  ipcMain.on(CONTROL_BACK_CHANNEL, (event) => {
    if (!govShellWindow || event.sender.id !== govShellWindow.webContents.id) {
      logSecurityWarn('[gov-window] emissor nao autorizado para voltar', {
        senderId: event.sender.id
      })
      return
    }

    if (
      govContentWindow &&
      !govContentWindow.isDestroyed() &&
      govContentWindow.webContents.canGoBack()
    ) {
      govContentWindow.webContents.goBack()
      return
    }

    closeGovWindow('back')
  })

  ipcMain.on(CONTROL_CLOSE_CHANNEL, (event) => {
    if (!govShellWindow || event.sender.id !== govShellWindow.webContents.id) {
      logSecurityWarn('[gov-window] emissor nao autorizado para fechar', {
        senderId: event.sender.id
      })
      return
    }

    closeGovWindow('exit')
  })
}

function isGovAuthUrl(url: string) {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.toLowerCase()

    return (
      (hostname === 'sso.acesso.gov.br' || hostname === 'acesso.gov.br') &&
      (pathname.includes('/login') ||
        pathname.includes('/authorize') ||
        pathname.includes('/logout'))
    )
  } catch {
    return false
  }
}

function isAllowedGovContentUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && GOV_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function getGovAuthCrashKey(url: string) {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.toLowerCase()

    if (hostname === 'sso.acesso.gov.br' || hostname === 'acesso.gov.br') {
      return `${hostname}${pathname}`
    }

    return url
  } catch {
    return url
  }
}

function getDisplayBounds(referenceWindow: BrowserWindow) {
  if (referenceWindow.isDestroyed()) {
    return screen.getPrimaryDisplay().bounds
  }

  return screen.getDisplayMatching(referenceWindow.getBounds()).bounds
}

const GOV_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;"

function buildGovShellHtml() {
  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="${GOV_CSP}" />
        <style>
          ${SINE_BASE_CSS}
          html, body { width: 100%; height: 100%; overflow: hidden; background: #fff; }

          .bar {
            position: relative;
            height: 100%;
            display: flex;
            align-items: center;
            gap: 24px;
            padding: 0 32px 4px;
          }
          .bar::after {
            content: "";
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            height: 4px;
            background: ${SINE_COLORS.amarelo};
          }
          .bar .sine-btn { min-height: 60px; font-size: 21px; }
          .titulo {
            flex: 1;
            text-align: center;
            font-size: 20px;
            font-weight: 700;
            color: ${SINE_COLORS.texto2};
          }
          .titulo b { color: ${SINE_COLORS.azul90}; font-weight: 800; }
        </style>
      </head>
      <body>
        <div class="bar">
          <button class="sine-btn sine-btn--sec" id="gov-back" type="button">${SINE_ICONS.voltar}Voltar</button>
          <div class="titulo"><b>Carteira de Trabalho Digital</b> · portal oficial gov.br</div>
          <button class="sine-btn sine-btn--pri" id="gov-exit" type="button">${SINE_ICONS.inicio}Voltar ao início</button>
        </div>

        <script>
          document.getElementById("gov-back")?.addEventListener("click", () => {
            window.totemGovControls?.back?.();
          });
          document.getElementById("gov-exit")?.addEventListener("click", () => {
            window.totemGovControls?.exit?.();
          });
        </script>
      </body>
    </html>
  `
}

const GOV_PAGE_CSS = `
  ${SINE_BASE_CSS}
  html, body { width: 100%; height: 100%; overflow: hidden; background: ${SINE_COLORS.fundo}; }
  body { display: flex; align-items: center; justify-content: center; }
  .wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    max-width: 760px;
    padding: 56px 64px;
    border-radius: 32px;
    background: #fff;
    border: 2px solid ${SINE_COLORS.borda};
    text-align: center;
  }
  .title { font-size: 40px; font-weight: 900; line-height: 1.15; color: ${SINE_COLORS.azul90}; }
  .detail { font-size: 24px; line-height: 1.45; color: ${SINE_COLORS.texto2}; }
  .icone {
    display: grid;
    place-items: center;
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background: #FFF4C2;
    color: #8A6A00;
  }
  .icone svg { width: 52px; height: 52px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .acoes { margin-top: 12px; display: flex; gap: 16px; }
`

function buildGovLoadingHtml() {
  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="${GOV_CSP}" />
        <style>${GOV_PAGE_CSS}</style>
      </head>
      <body>
        <div class="wrap">
          <div class="sine-spinner"></div>
          <div class="title">Abrindo a Carteira de Trabalho Digital</div>
          <div class="detail">Aguarde um instante enquanto carregamos o portal oficial do governo.</div>
        </div>
      </body>
    </html>
  `
}

function buildGovStatusHtml(message: string, detail: string, retryUrl?: string, loading = false) {
  const escapeHtml = (value: string) =>
    String(value || '').replace(/[&<>"']/g, (char) => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }

      return map[char] || char
    })

  const safeMessage = escapeHtml(message)
  const safeDetail = escapeHtml(detail)
  const safeRetryUrl = retryUrl ? JSON.stringify(String(retryUrl)) : ''

  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="${GOV_CSP}" />
        <style>${GOV_PAGE_CSS}</style>
      </head>
      <body>
        <div class="wrap">
          ${loading ? '<div class="sine-spinner"></div>' : `<div class="icone">${SINE_ICONS.alerta}</div>`}
          <div class="title">${safeMessage}</div>
          <div class="detail">${safeDetail}</div>
          ${
            retryUrl
              ? `<div class="acoes"><button class="sine-btn sine-btn--pri" id="retry-gov" type="button">${SINE_ICONS.repetir}Tentar novamente</button></div>`
              : ''
          }
        </div>
        ${
          retryUrl
            ? `<script>
                document.getElementById("retry-gov")?.addEventListener("click", () => {
                  window.location.replace(${safeRetryUrl});
                });
              </script>`
            : ''
        }
      </body>
    </html>
  `
}

function showGovStatus(message: string, detail = 'Aguarde alguns instantes.') {
  if (!govContentWindow || govContentWindow.isDestroyed()) return

  void govContentWindow
    .loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        buildGovStatusHtml(message, detail, undefined, message.startsWith('Recuperando'))
      )}`
    )
    .catch(() => {})
}

function showGovRetryStatus(message: string, detail: string, retryUrl: string) {
  if (!govContentWindow || govContentWindow.isDestroyed()) return

  void govContentWindow
    .loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        buildGovStatusHtml(message, detail, retryUrl || GOV_LOGIN_URL)
      )}`
    )
    .catch(() => {})
}

function injectGovContentStyle(windowRef: BrowserWindow) {
  if (windowRef.isDestroyed() || windowRef.webContents.isDestroyed()) return

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
    .catch(() => {})
}

function destroyGovWindows() {
  if (govShellWindow && !govShellWindow.isDestroyed()) {
    govShellWindow.destroy()
  }

  if (govContentWindow && !govContentWindow.isDestroyed()) {
    govContentWindow.destroy()
  }

  govShellWindow = null
  govContentWindow = null
  recovering = false
  govPartition = ''
  govShellReady = false
  govContentReady = false
  lastGovOpenUrl = ''
  lastGovOpenAt = 0
  lastGovAuthCrashKey = ''
  lastGovAuthCrashAt = 0
  lastGovAuthCrashCount = 0
}

function showParentWithoutFlash() {
  if (!parentWindowRef || parentWindowRef.isDestroyed()) return
  parentWindowRef.show()
  parentWindowRef.focus()
}

export function closeGovWindow(reason: 'exit' | 'back' | 'crash' = 'exit') {
  const parent = parentWindowRef
  logSecurityInfo('[gov-window] fechando fluxo GOV', { reason, lastGovUrl })

  destroyGovWindows()
  lastGovUrl = GOV_LOGIN_URL

  if (!parent || parent.isDestroyed()) return

  showParentWithoutFlash()

  if (reason === 'back') {
    try {
      if (parent.webContents.canGoBack()) {
        parent.webContents.goBack()
        return
      }
    } catch {
      // noop
    }
  }

  if (reason === 'exit' || reason === 'crash') {
    void parent.loadURL(START_URL).catch(() => {})
  }
}

export function closeGovWindowAndReturnHome(reason: 'exit' | 'back' | 'crash' = 'exit') {
  closeGovWindow(reason)
}

export function isGovSensitiveUrl(url: string) {
  try {
    const parsed = new URL(url)
    return GOV_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function syncGovWindowBounds(parentWindow: BrowserWindow) {
  if (!govShellWindow || !govContentWindow) return
  if (govShellWindow.isDestroyed() || govContentWindow.isDestroyed()) return

  const bounds = getDisplayBounds(parentWindow)
  govShellWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: TOP_BAR_HEIGHT
  })

  govContentWindow.setBounds({
    x: bounds.x,
    y: bounds.y + TOP_BAR_HEIGHT,
    width: bounds.width,
    height: Math.max(100, bounds.height - TOP_BAR_HEIGHT)
  })

  enforceGovTopmost()
}

function finalizeGovPresentation() {
  if (!parentWindowRef || parentWindowRef.isDestroyed()) return
  if (!govShellWindow || !govContentWindow) return
  if (govShellWindow.isDestroyed() || govContentWindow.isDestroyed()) return
  if (!govShellReady || !govContentReady) return

  govShellWindow.showInactive()
  govContentWindow.show()
  enforceGovTopmost()
  parentWindowRef.hide()
  govShellWindow.focus()
  govContentWindow.focus()
}

function shouldIgnoreDuplicateGovOpen(url: string) {
  const now = Date.now()
  if (lastGovOpenUrl === url && now - lastGovOpenAt < 1500) {
    return true
  }

  lastGovOpenUrl = url
  lastGovOpenAt = now
  return false
}

function registerGovAuthCrashAttempt(url: string) {
  const key = getGovAuthCrashKey(url)
  const now = Date.now()
  if (
    lastGovAuthCrashKey === key &&
    now - lastGovAuthCrashAt <= GOV_AUTH_SAME_URL_RETRY_WINDOW_MS
  ) {
    lastGovAuthCrashCount += 1
  } else {
    lastGovAuthCrashKey = key
    lastGovAuthCrashAt = now
    lastGovAuthCrashCount = 1
  }

  return lastGovAuthCrashCount
}

function loadGovUrl(url: string, attempt = 0) {
  if (!govContentWindow || govContentWindow.isDestroyed()) return
  if (!isAllowedGovContentUrl(url)) {
    logSecurityWarn('[gov-window] bloqueado loadURL fora da allowlist', { url, attempt })
    showGovStatus('Navegação bloqueada', 'Este endereço não faz parte do portal oficial.')
    return
  }

  void govContentWindow.loadURL(url).catch((error: { code?: string }) => {
    logSecurityError('[gov-window] falha ao abrir URL', { url, attempt, error })

    if (error?.code === 'ERR_FAILED' && attempt < 1) {
      setTimeout(() => {
        loadGovUrl(url, attempt + 1)
      }, 300)
      return
    }

    closeGovWindow('crash')
  })
}

function ensureGovWindows(parentWindow: BrowserWindow) {
  registerControlsIpc()

  if (
    govShellWindow &&
    !govShellWindow.isDestroyed() &&
    govContentWindow &&
    !govContentWindow.isDestroyed()
  ) {
    syncGovWindowBounds(parentWindow)
    return
  }

  const bounds = getDisplayBounds(parentWindow)
  govPartition = `temp:gov-${Date.now()}`

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
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: govPartition,
      devTools: false
    }
  })

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
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: govPartition,
      devTools: false
    }
  })

  registerKeyboardAvoidance(govContentWindow)

  govShellWindow.once('ready-to-show', () => {
    govShellReady = true
    finalizeGovPresentation()
  })

  govContentWindow.once('ready-to-show', () => {
    govContentReady = true
    finalizeGovPresentation()
  })

  void govShellWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildGovShellHtml())}`
  )
  void govContentWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildGovLoadingHtml())}`
  )

  govShellWindow.on('closed', () => {
    if (govContentWindow && !govContentWindow.isDestroyed()) {
      govContentWindow.destroy()
    }
    govShellWindow = null
    govContentWindow = null
    recovering = false
    showParentWithoutFlash()
  })

  govShellWindow.on('show', enforceGovTopmost)
  govShellWindow.on('focus', enforceGovTopmost)
  govShellWindow.on('restore', enforceGovTopmost)

  govContentWindow.on('closed', () => {
    if (govShellWindow && !govShellWindow.isDestroyed()) {
      govShellWindow.destroy()
    }
    govShellWindow = null
    govContentWindow = null
    recovering = false
    showParentWithoutFlash()
  })

  govContentWindow.on('show', enforceGovTopmost)
  govContentWindow.on('focus', enforceGovTopmost)
  govContentWindow.on('restore', enforceGovTopmost)

  govContentWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (!govContentWindow || govContentWindow.isDestroyed()) {
      return { action: 'deny' }
    }

    if (isAllowedGovContentUrl(nextUrl)) {
      lastGovUrl = nextUrl
      void govContentWindow.loadURL(nextUrl).catch(() => {})
      logSecurityInfo('[gov-window] popup interno permitido', { url: nextUrl })
    } else {
      logSecurityWarn('[gov-window] popup bloqueado fora da allowlist', { url: nextUrl })
    }

    return { action: 'deny' }
  })

  govContentWindow.webContents.on('will-navigate', (event, nextUrl) => {
    if (nextUrl.startsWith('data:text/html')) {
      return
    }

    if (!isAllowedGovContentUrl(nextUrl)) {
      event.preventDefault()
      logSecurityWarn('[gov-window] navegacao bloqueada fora da allowlist', { url: nextUrl })
      showGovStatus('Navegação bloqueada', 'Este endereço não faz parte do portal oficial.')
    }
  })

  govContentWindow.webContents.on('will-redirect', (event, nextUrl) => {
    if (!isAllowedGovContentUrl(nextUrl)) {
      event.preventDefault()
      logSecurityWarn('[gov-window] redirecionamento bloqueado fora da allowlist', { url: nextUrl })
      showGovStatus(
        'Redirecionamento bloqueado',
        'Este endereço não faz parte do portal oficial.'
      )
    }
  })

  govContentWindow.webContents.on('did-navigate', (_event, nextUrl) => {
    if (isGovSensitiveUrl(nextUrl)) {
      lastGovUrl = nextUrl
    }
  })

  govContentWindow.webContents.on('did-navigate-in-page', (_event, nextUrl) => {
    if (isGovSensitiveUrl(nextUrl)) {
      lastGovUrl = nextUrl
    }
  })

  govContentWindow.webContents.on('did-finish-load', () => {
    injectGovContentStyle(govContentWindow as BrowserWindow)
  })

  govContentWindow.webContents.on('render-process-gone', (_event, details) => {
    logSecurityError('[gov-window] render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      lastGovUrl
    })

    if (!govContentWindow || govContentWindow.isDestroyed()) return

    if (details.reason !== 'crashed') {
      closeGovWindow('crash')
      return
    }

    const crashedUrl = lastGovUrl

    if (recovering) {
      showGovStatus(
        'Não foi possível abrir o login do gov.br',
        'O portal do governo está instável. Toque em Voltar ou tente de novo em instantes.'
      )
      loadGovUrl(GOV_LOGIN_URL)
      recovering = false
      return
    }

    if (!isGovAuthUrl(crashedUrl)) {
      recovering = true
      showGovStatus('Recuperando acesso', 'Aguarde alguns instantes.')
      loadGovUrl(GOV_LOGIN_URL)
      recovering = false
      return
    }

    const crashAttempt = registerGovAuthCrashAttempt(crashedUrl)

    if (crashAttempt <= GOV_AUTH_SAME_URL_RETRY_LIMIT) {
      recovering = true
      showGovStatus(
        'Recuperando acesso',
        'O portal do gov.br ficou instável. Estamos tentando de novo.'
      )
      setTimeout(() => {
        recovering = false
        loadGovUrl(crashedUrl, 0)
      }, 350)
      return
    }

    recovering = false
    showGovRetryStatus(
      'Não foi possível abrir o login do gov.br',
      'O portal do governo continua instável. Toque em Tentar novamente ou em Voltar ao início.',
      GOV_LOGIN_URL
    )
  })
}

export function openGovWindow(parentWindow: BrowserWindow, url: string) {
  if (!isAllowedGovContentUrl(url)) {
    logSecurityWarn('[gov-window] tentativa de abrir GOV com URL nao permitida', { url })
    return null
  }

  parentWindowRef = parentWindow
  lastGovUrl = url

  if (shouldIgnoreDuplicateGovOpen(url)) {
    logSecurityInfo('[gov-window] ignorando abertura duplicada', { url })
    return govContentWindow
  }

  ensureGovWindows(parentWindow)
  syncGovWindowBounds(parentWindow)

  if (!govShellWindow || !govContentWindow) {
    return null
  }

  if (govShellReady && govContentReady) {
    finalizeGovPresentation()
  }

  const currentUrl = govContentWindow.webContents.getURL()
  if (currentUrl !== url) {
    loadGovUrl(url)
  }

  return govContentWindow
}
