import type { BrowserWindow } from "electron";
import { registerAppIpc } from "./app";
import { registerGovWindowIpc } from "./govWindow";
// src/main/ipc/index.ts
import { registerPingIpc } from './ping'
import { registerPrintIpc } from './print'
import { registerSpeechIpc } from './speech'
import { registerInputIpc } from './input'

export function registerIpc(getMainWindow: () => BrowserWindow | null) {
  registerAppIpc(getMainWindow)
  registerGovWindowIpc()
  registerPingIpc()
  registerPrintIpc()
  registerSpeechIpc()
  registerInputIpc()
}
