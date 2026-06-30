import { ipcMain } from 'electron'

export function registerInputIpc() {
  ipcMain.handle('totem-insert-text', async (event, text: string) => {
    const value = String(text ?? '')
    if (!value) return { success: false }

    event.sender.focus()
    await event.sender.insertText(value)
    return { success: true }
  })

  ipcMain.handle('totem-send-key', async (event, keyCode: string) => {
    const key = String(keyCode ?? '')
    if (!key) return { success: false }

    event.sender.focus()
    event.sender.sendInputEvent({ type: 'keyDown', keyCode: key })
    event.sender.sendInputEvent({ type: 'keyUp', keyCode: key })
    return { success: true }
  })

  ipcMain.handle(
    'totem-type-key',
    async (event, payload: { keyCode?: string; text?: string; isBackspace?: boolean; isEnter?: boolean }) => {
      const keyCode = String(payload?.keyCode ?? '')
      const text = String(payload?.text ?? '')
      const isBackspace = !!payload?.isBackspace
      const isEnter = !!payload?.isEnter

      if (!keyCode && !text && !isBackspace && !isEnter) return { success: false }

      event.sender.focus()

      const code = keyCode || (isBackspace ? 'Backspace' : isEnter ? 'Enter' : text)
      event.sender.sendInputEvent({ type: 'keyDown', keyCode: code })

      if (text) {
        event.sender.sendInputEvent({ type: 'char', keyCode: text })
      }

      event.sender.sendInputEvent({ type: 'keyUp', keyCode: code })
      return { success: true }
    }
  )
}
