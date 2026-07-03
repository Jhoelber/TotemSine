/// <reference types="vite/client" />

interface Window {
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
    keyboardShow?: () => Promise<{ success: boolean }>
    keyboardHide?: () => Promise<{ success: boolean }>
    keyboardAction?: (payload: {
      kind: string
      text?: string
    }) => Promise<{ success: boolean }>
    onKeyboardReset?: (callback: () => void) => () => void
    resetToHome?: () => Promise<{ success: boolean; failureReason?: string }>
  }
}
