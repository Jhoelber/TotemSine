// src/main/ipc/index.ts
import { registerPingIpc } from './ping'
import { registerPrintIpc } from './print'
import { registerSpeechIpc } from './speech'
import { registerInputIpc } from './input'

export function registerIpc() {
  registerPingIpc()
  registerPrintIpc()
  registerSpeechIpc()
  registerInputIpc()
}
