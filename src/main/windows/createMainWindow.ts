// src/main/windows/createMainWindow.ts
import { app, BrowserWindow, Menu } from "electron";
import { join } from "path";
import icon from "../../../resources/icon.png?asset";
import { START_URL } from "../config/constants";


export function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    frame: false,
    show: false,
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });


  Menu.setApplicationMenu(Menu.buildFromTemplate([]));

  mainWindow.loadURL(START_URL);

 

  return mainWindow;
}
