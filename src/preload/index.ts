import { contextBridge, ipcRenderer } from 'electron'
const DEFAULT_SPEECH_API_URL = 'https://lpxsine.vercel.app/api/speech-to-text'
const DEFAULT_SPEECH_FALLBACK_API_URL = 'https://lpxsine.vercel.app/api/jobs-voice-assistant'
const JOBS_SNAPSHOT_URL = 'https://vagas.jacarezinho.cloud/api/v1/vagas-semana'
const SPEECH_REQUEST_TIMEOUT_MS = 15000
const TRUSTED_APP_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'lpxsine.vercel.app',
  'jacarezinho.govbr.cloud',
  'jacarezinho.pr.gov.br',
  'www.jacarezinho.pr.gov.br',
  'webapp1-jacarezinho.cidade360.cloud',
  'duvidas-mei.vercel.app',
  'totemvoz.vercel.app'
])
const TRUSTED_KEYBOARD_HOSTS = new Set([
  'servicos.mte.gov.br',
  'sso.acesso.gov.br',
  'acesso.gov.br'
])
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development'

function getDecodedPathname() {
  try {
    return decodeURIComponent(window.location.pathname || '').toLowerCase()
  } catch {
    return String(window.location.pathname || '').toLowerCase()
  }
}

function isPdfViewerPage() {
  return (
    window.location.protocol === 'file:' &&
    getDecodedPathname().includes('/viewer-cache/pdf-viewer.html')
  )
}

function isTrustedAppPage() {
  const { protocol, hostname } = window.location
  if (protocol === 'file:') return isPdfViewerPage()
  if (protocol !== 'http:' && protocol !== 'https:') return false
  return TRUSTED_APP_HOSTS.has(hostname.toLowerCase())
}

function isTrustedKeyboardPage() {
  const { protocol, hostname } = window.location
  if (protocol === 'file:') return true
  if (protocol !== 'http:' && protocol !== 'https:') return false

  const normalizedHost = hostname.toLowerCase()
  return TRUSTED_APP_HOSTS.has(normalizedHost) || TRUSTED_KEYBOARD_HOSTS.has(normalizedHost)
}

function isGovShellPage() {
  return window.location.protocol === 'data:'
}

function resolveSpeechApiUrl() {
  try {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.protocol === 'http:' || currentUrl.protocol === 'https:') {
      return new URL('/api/speech-to-text', currentUrl.origin).toString()
    }
  } catch {
    // noop
  }

  return DEFAULT_SPEECH_API_URL
}

function resolveSpeechFallbackApiUrl() {
  try {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.protocol === 'http:' || currentUrl.protocol === 'https:') {
      return new URL('/api/jobs-voice-assistant', currentUrl.origin).toString()
    }
  } catch {
    // noop
  }

  return DEFAULT_SPEECH_FALLBACK_API_URL
}

async function fetchJobsSnapshot() {
  const response = await fetch(JOBS_SNAPSHOT_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    cache: 'no-store'
  })

  if (!response.ok) {
    throw new Error(`Jobs snapshot HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    jobs?: string[]
    publicationDate?: string
    updatedAt?: string
  }

  return {
    jobs: Array.isArray(payload.jobs)
      ? payload.jobs.filter((job): job is string => typeof job === 'string')
      : [],
    publicationDate: String(payload.publicationDate || ''),
    updatedAt: String(payload.updatedAt || '')
  }
}

async function fetchSpeechTranscript(audioBase64: string) {
  let content = String(audioBase64 || '').trim()
  let mimeType = 'audio/webm'

  const commaIndex = content.indexOf(',')
  if (content.startsWith('data:') && commaIndex !== -1) {
    const meta = content.slice(5, commaIndex)
    mimeType = meta.split(';')[0] || mimeType
    content = content.slice(commaIndex + 1)
  }

  if (!content) {
    return ''
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), SPEECH_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(resolveSpeechApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audioBase64: content,
        mimeType
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      if (response.status !== 404) {
        throw new Error(`Speech API HTTP ${response.status}: ${errorText}`)
      }

      console.warn(
        '[preload] /api/speech-to-text nao encontrado, usando fallback /api/jobs-voice-assistant'
      )

      const snapshot = await fetchJobsSnapshot()
      const fallbackResponse = await fetch(resolveSpeechFallbackApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audioBase64: content,
          mimeType,
          jobs: snapshot.jobs,
          publicationDate: snapshot.publicationDate,
          updatedAt: snapshot.updatedAt
        }),
        signal: controller.signal
      })

      if (!fallbackResponse.ok) {
        const fallbackErrorText = await fallbackResponse.text()
        throw new Error(`Voice fallback API HTTP ${fallbackResponse.status}: ${fallbackErrorText}`)
      }

      const fallbackPayload = (await fallbackResponse.json()) as { transcript?: string }
      return typeof fallbackPayload?.transcript === 'string'
        ? fallbackPayload.transcript.trim()
        : ''
    }

    const payload = (await response.json()) as { transcript?: string }
    return typeof payload?.transcript === 'string' ? payload.transcript.trim() : ''
  } finally {
    window.clearTimeout(timeoutId)
  }
}

declare global {
  interface Window {
    totemVoz?: {
      transcrever: (audioBase64: string) => Promise<string>
    }
    totemGov?: {
      close: (action?: 'back' | 'exit') => Promise<{ success: boolean }>
    }
    totemGovControls?: {
      back: () => void
      exit: () => void
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
      keyboardShow?: () => Promise<{ success: boolean }>
      keyboardHide?: () => Promise<{ success: boolean }>
      keyboardAction?: (payload: { kind: string; text?: string }) => Promise<{ success: boolean }>
      onKeyboardReset?: (callback: () => void) => () => void
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
  keyboardShow: () => ipcRenderer.invoke('totem-keyboard-show'),
  keyboardHide: () => ipcRenderer.invoke('totem-keyboard-hide'),
  keyboardAction: (payload: { kind: string; text?: string }) =>
    ipcRenderer.invoke('totem-keyboard-action', payload),
  onKeyboardReset: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('totem-keyboard-reset', listener)
    return () => {
      ipcRenderer.removeListener('totem-keyboard-reset', listener)
    }
  },
  resetToHome: () => ipcRenderer.invoke('totem-reset-to-home')
}

const totemGovApi = {
  close: (action?: 'back' | 'exit') => ipcRenderer.invoke('totem-gov-close', action)
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  if (target instanceof HTMLInputElement) {
    return (
      !target.readOnly &&
      !target.disabled &&
      ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(target.type)
    )
  }

  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled
  }

  return target.isContentEditable
}

function isInteractiveElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return Boolean(
    target.closest(
      [
        'a[href]',
        'button',
        'input',
        'select',
        'textarea',
        'label',
        'iframe',
        'canvas',
        'svg',
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[tabindex]',
        '[class*="captcha" i]',
        '[id*="captcha" i]',
        '[class*="challenge" i]',
        '[id*="challenge" i]'
      ].join(',')
    )
  )
}

function installKeyboardFocusDetector() {
  const globalState = globalThis as typeof globalThis & {
    __LPX_PRELOAD_KEYBOARD_DETECTOR__?: boolean
  }

  if (globalState.__LPX_PRELOAD_KEYBOARD_DETECTOR__) return
  globalState.__LPX_PRELOAD_KEYBOARD_DETECTOR__ = true
  const isGovHost =
    location.hostname === 'sso.acesso.gov.br' || location.hostname === 'acesso.gov.br'
  let suppressGovOutsideClickUntil = 0

  const isSuppressedGovOutsideClick = (event: Event) => {
    return (
      isGovHost &&
      Date.now() < suppressGovOutsideClickUntil &&
      !isEditableElement(event.target) &&
      !isInteractiveElement(event.target)
    )
  }

  const consumeEvent = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const showKeyboard = () => {
    ipcRenderer.invoke('totem-keyboard-show').catch(() => {})
  }

  const hideKeyboard = () => {
    ipcRenderer.invoke('totem-keyboard-hide').catch(() => {})
  }

  const maybeShowKeyboard = (event: Event) => {
    if (isSuppressedGovOutsideClick(event)) {
      consumeEvent(event)
      return
    }
    if (!isEditableElement(event.target)) return
    showKeyboard()
  }

  const maybeHideKeyboard = (event: Event) => {
    if (isEditableElement(event.target)) return
    if (isGovHost) {
      if (isInteractiveElement(event.target)) return
      suppressGovOutsideClickUntil = Date.now() + 700
      consumeEvent(event)
      hideKeyboard()
      return
    }
    setTimeout(() => {
      if (!isEditableElement(document.activeElement)) {
        hideKeyboard()
      }
    }, 60)
  }

  const consumeSuppressedGovOutsideClick = (event: Event) => {
    if (!isSuppressedGovOutsideClick(event)) return
    consumeEvent(event)
  }

  window.addEventListener('click', consumeSuppressedGovOutsideClick, true)
  window.addEventListener('pointerup', maybeShowKeyboard, true)
  window.addEventListener('mouseup', consumeSuppressedGovOutsideClick, true)
  window.addEventListener('mouseup', maybeShowKeyboard, true)
  window.addEventListener('touchend', consumeSuppressedGovOutsideClick, true)
  window.addEventListener('touchend', maybeShowKeyboard, true)
  window.addEventListener('pointerdown', maybeHideKeyboard, true)
}

const isKeyboardRendererRoute =
  window.location.hash === '#/keyboard' || window.location.hash.startsWith('#/keyboard?')

if (!isKeyboardRendererRoute && isTrustedKeyboardPage()) {
  installKeyboardFocusDetector()
}

const keyboardOnlyTotemApi = {
  keyboardShow: totemApi.keyboardShow,
  keyboardHide: totemApi.keyboardHide,
  keyboardAction: totemApi.keyboardAction,
  onKeyboardReset: totemApi.onKeyboardReset
}

const govControlApi = {
  back: () => ipcRenderer.send('lpx-gov-control-back'),
  exit: () => ipcRenderer.send('lpx-gov-control-close')
}

if (process.contextIsolated) {
  try {
    if (isTrustedAppPage()) {
      contextBridge.exposeInMainWorld('totem', totemApi)
    } else if (isTrustedKeyboardPage()) {
      contextBridge.exposeInMainWorld('totem', keyboardOnlyTotemApi)
    }

    if (isTrustedAppPage()) {
      contextBridge.exposeInMainWorld('totemGov', totemGovApi)
    }

    if (isGovShellPage()) {
      contextBridge.exposeInMainWorld('totemGovControls', govControlApi)
    }

    if (isTrustedAppPage()) {
      contextBridge.exposeInMainWorld('totemVoz', {
        async transcrever(audioBase64: string) {
          try {
            return await fetchSpeechTranscript(audioBase64)
          } catch (error) {
            console.warn('[preload] fetch direto da fala falhou, usando fallback IPC:', error)
            const texto = await ipcRenderer.invoke('totem-voz-transcrever', audioBase64)
            return texto as string
          }
        }
      })
    }
  } catch (error) {
    console.error('[preload] erro ao expor APIs:', error)
  }
} else {
  if (isTrustedAppPage()) {
    window.totem = totemApi
  } else if (isTrustedKeyboardPage()) {
    window.totem = keyboardOnlyTotemApi
  }

  if (isTrustedAppPage()) {
    window.totemGov = totemGovApi
  }

  if (isGovShellPage()) {
    window.totemGovControls = govControlApi
  }

  if (isTrustedAppPage()) {
    window.totemVoz = {
      async transcrever(audioBase64: string) {
        try {
          return await fetchSpeechTranscript(audioBase64)
        } catch (error) {
          console.warn('[preload] fetch direto da fala falhou, usando fallback IPC:', error)
          const texto = await ipcRenderer.invoke('totem-voz-transcrever', audioBase64)
          return texto as string
        }
      }
    }
  }

  if (isDev) {
    console.log('[preload] APIs do totem registradas')
  }
}
