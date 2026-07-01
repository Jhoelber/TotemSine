import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {}

declare global {
  interface Window {
    electron: typeof electronAPI
    api: typeof api
    totemVoz?: {
      transcrever: (audioBase64: string) => Promise<string>
    }
    totem?: {
      printFileSilent?: (
        filePath: string,
        deviceName?: string
      ) => Promise<{ success: boolean; failureReason?: string }>
      openPdfPreviewFromHtml?: (payload: {
        html: string
        fileName?: string
      }) => Promise<{ success: boolean; filePath?: string; failureReason?: string }>
      getPrinterStatus?: () => Promise<{
        available: boolean
        name?: string
        message?: string
      }>
      insertText?: (text: string) => Promise<{ success: boolean }>
      sendKey?: (keyCode: string) => Promise<{ success: boolean }>
      typeKey?: (payload: {
        keyCode?: string
        text?: string
        isBackspace?: boolean
        isEnter?: boolean
      }) => Promise<{ success: boolean }>
      resetToHome?: () => Promise<{ success: boolean; failureReason?: string }>
    }
  }
}

const totemApi = {
  printFileSilent: (filePath: string, deviceName?: string) =>
    ipcRenderer.invoke('totem-print-file-silent', { filePath, deviceName }),
  openPdfPreviewFromHtml: (payload: { html: string; fileName?: string }) =>
    ipcRenderer.invoke('totem-open-pdf-preview-from-html', payload),
  getPrinterStatus: () => ipcRenderer.invoke('totem-printer-status'),
  insertText: (text: string) => ipcRenderer.invoke('totem-insert-text', text),
  sendKey: (keyCode: string) => ipcRenderer.invoke('totem-send-key', keyCode),
  typeKey: (payload: {
    keyCode?: string
    text?: string
    isBackspace?: boolean
    isEnter?: boolean
  }) => ipcRenderer.invoke('totem-type-key', payload),
  resetToHome: () => ipcRenderer.invoke('totem-reset-to-home')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('totem', totemApi)

    contextBridge.exposeInMainWorld('totemVoz', {
      async transcrever(audioBase64: string) {
        const texto = await ipcRenderer.invoke('totem-voz-transcrever', audioBase64)
        return texto as string
      }
    })
  } catch (error) {
    console.error('[preload] erro ao expor APIs:', error)
  }
} else {
  window.electron = electronAPI
  window.api = api
  window.totem = totemApi

  window.totemVoz = {
    async transcrever(audioBase64: string) {
      const texto = await ipcRenderer.invoke('totem-voz-transcrever', audioBase64)
      return texto as string
    }
  }

  console.log('[preload] APIs do totem registradas')
}
