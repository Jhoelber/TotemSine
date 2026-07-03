// src/main/windows/createMainWindow.ts
import { app, BrowserWindow, Menu, screen } from 'electron'
import { join } from 'path'
import icon from '../../../resources/icon.png?asset'
import { START_URL } from '../config/constants'

export function createMainWindow() {
  const { bounds } = screen.getPrimaryDisplay()
  const mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    thickFrame: false,
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    hasShadow: false,
    roundedCorners: false,
    movable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate([]))

  mainWindow.loadURL(START_URL)

  return mainWindow
}
