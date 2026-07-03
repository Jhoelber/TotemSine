import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { START_URL } from '../config/constants'
import { assertTrustedRendererUrl } from '../security/trustedOrigins'
import { resetTotemSession } from '../services/sessionReset'

export function registerAppIpc(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('totem-reset-to-home', async (event) => {
    try {
      assertTrustedRendererUrl(event.senderFrame?.url || '', 'retornar ao inicio')

      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { success: false, failureReason: 'Janela principal indisponivel.' }
      }

      await resetTotemSession(mainWindow)
      await mainWindow.loadURL(START_URL)

      return { success: true }
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Falha ao resetar sessao.'
      return { success: false, failureReason }
    }
  })
}
