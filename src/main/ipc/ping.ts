// src/main/ipc/ping.ts
import { ipcMain } from 'electron'

export function registerPingIpc() {
  ipcMain.on('ping', () => console.log('pong'))
}
