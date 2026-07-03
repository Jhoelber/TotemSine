// src/main/index.ts
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { createMainWindow } from './windows/createMainWindow'
import { registerIpc } from './ipc'
import { registerOpenInSameWindow } from './services/windowOpen'
import { registerDownloads } from './services/downloads'
import { registerConnectivity } from './services/connectivity'
import { registerIdle } from './services/idle'
import { registerNavigation } from './services/navigation'
import { registerKeyboardAvoidance } from './services/keyboardAvoidance'
import { registerWatchdog } from './services/watchdog'
import { registerAutoUpdates } from './services/updates'
import { isTrustedMediaOrigin } from './security/trustedOrigins'
import { logSecurityInfo, logSecurityWarn } from './services/securityLog'

const isDev = !app.isPackaged

const appDataRoot = app.getPath('appData')
const localDataRoot = path.join(appDataRoot, 'totemSine')
const sessionDataRoot = path.join(localDataRoot, 'session')
const cacheDataRoot = path.join(localDataRoot, 'cache')

for (const dir of [localDataRoot, sessionDataRoot, cacheDataRoot]) {
  fs.mkdirSync(dir, { recursive: true })
}

app.setPath('userData', localDataRoot)
app.setPath('sessionData', sessionDataRoot)
app.commandLine.appendSwitch('disk-cache-dir', cacheDataRoot)

if (!isDev) {
  app.commandLine.appendSwitch('kiosk-printing')
}

app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

let mainWindow: BrowserWindow | null = null

function shouldLogDeniedPermission(requestingOrigin: string) {
  return Boolean(requestingOrigin && requestingOrigin !== 'about:blank')
}

function allowMediaPermission(permission: string, requestingUrl: string) {
  const mediaPermissions = new Set(['media', 'microphone', 'audioCapture'])
  return mediaPermissions.has(permission) && isTrustedMediaOrigin(requestingUrl)
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('before-input-event', (event, input) => {
    if (isDev) return

    const key = (input.key || '').toLowerCase()
    const ctrl = input.control || input.meta
    const shift = input.shift
    const alt = input.alt

    const block =
      (alt && input.code === 'F4') ||
      key === 'f5' ||
      (ctrl && key === 'r') ||
      (ctrl && shift && key === 'r') ||
      (alt && (key === 'left' || key === 'right')) ||
      key === 'browserback' ||
      key === 'browserforward' ||
      (ctrl && (key === 'w' || key === 't' || key === 'n')) ||
      key === 'f12' ||
      (ctrl && shift && key === 'i') ||
      (ctrl && shift && key === 'j') ||
      (ctrl && (key === '+' || key === '=' || key === '-' || key === '0')) ||
      (ctrl && key === 'add') ||
      (ctrl && key === 'subtract') ||
      key === 'escape' ||
      key === 'f11' ||
      key === 'browserrefresh' ||
      (ctrl && (key === 'l' || key === 'p' || key === 's' || key === 'o' || key === 'u'))

    if (block) event.preventDefault()
  })

  if (!isDev) contents.on('context-menu', (e) => e.preventDefault())
})

function hardenKioskWindow(win: BrowserWindow) {
  const ensureKiosk = () => {
    if (win.isDestroyed()) return
    if (!win.isKiosk()) win.setKiosk(true)
    if (!win.isFullScreen()) win.setFullScreen(true)
    if (win.isMinimized()) win.restore()
    win.setFullScreenable(true)
    win.setResizable(false)
    win.setMovable(false)
    win.setMinimizable(false)
    win.setMaximizable(false)
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.focus()
  }

  win.on('leave-full-screen', ensureKiosk)
  win.on('leave-html-full-screen', ensureKiosk)
  win.on('unmaximize', ensureKiosk)
  win.on('minimize', ensureKiosk)
  win.on('restore', ensureKiosk)
  win.on('show', ensureKiosk)

  ensureKiosk()
}

function setupMainWindow(win: BrowserWindow) {
  hardenKioskWindow(win)
  registerOpenInSameWindow(win)
  registerKeyboardAvoidance(win)

  const idle = registerIdle(win)
  registerNavigation(win, idle)

  registerConnectivity(win)
  registerDownloads(win)
  registerWatchdog(win)
  registerAutoUpdates(win)

  win.on('ready-to-show', () => {
    hardenKioskWindow(win)
    win.show()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (allowMediaPermission(permission, requestingOrigin)) {
      logSecurityInfo('[permissions] permissao de midia aprovada', { permission, requestingOrigin })
      return true
    }

    if (shouldLogDeniedPermission(requestingOrigin)) {
      logSecurityWarn('[permissions] permissao negada', { permission, requestingOrigin })
    }
    return false
  })

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const allowed = allowMediaPermission(permission, details.requestingUrl)
    if (allowed) {
      logSecurityInfo('[permissions] solicitacao de permissao aprovada', {
        permission,
        requestingUrl: details.requestingUrl
      })
    } else if (shouldLogDeniedPermission(details.requestingUrl)) {
      logSecurityWarn('[permissions] solicitacao de permissao negada', {
        permission,
        requestingUrl: details.requestingUrl
      })
    }
    callback(allowed)
  })

  app.on('browser-window-created', (_, window) => {
    if (isDev) optimizer.watchWindowShortcuts(window)
  })

  registerIpc(() => mainWindow)

  // ✅ cria UMA única janela e usa ela pra tudo
  mainWindow = createMainWindow()
  logSecurityInfo('[startup] shell inicializado', {
    packaged: app.isPackaged,
    startUrl: mainWindow.webContents.getURL() || 'pending',
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData')
  })
  setupMainWindow(mainWindow)

  app.on('activate', () => {
    if (!mainWindow) {
      mainWindow = createMainWindow()
      setupMainWindow(mainWindow)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
