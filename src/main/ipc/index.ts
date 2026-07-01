import type { BrowserWindow } from "electron";
import { registerAppIpc } from "./app";
// src/main/ipc/index.ts
import { registerPingIpc } from './ping'
import { registerPrintIpc } from './print'
import { registerSpeechIpc } from './speech'
import { registerInputIpc } from './input'

export function registerIpc(getMainWindow: () => BrowserWindow | null) {
  registerAppIpc(getMainWindow)
  registerPingIpc()
  registerPrintIpc()
  registerSpeechIpc()
  registerInputIpc()
}
