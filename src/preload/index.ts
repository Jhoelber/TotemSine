import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {}
const DEFAULT_SPEECH_API_URL = 'https://lpxsine.vercel.app/api/speech-to-text'
const DEFAULT_SPEECH_FALLBACK_API_URL = 'https://lpxsine.vercel.app/api/jobs-voice-assistant'
const JOBS_SNAPSHOT_URL = 'https://vagas.jacarezinho.cloud/api/v1/vagas-semana'
const SPEECH_REQUEST_TIMEOUT_MS = 15000

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
    jobs: Array.isArray(payload.jobs) ? payload.jobs.filter((job): job is string => typeof job === 'string') : [],
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

      console.warn('[preload] /api/speech-to-text nao encontrado, usando fallback /api/jobs-voice-assistant')

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
      return typeof fallbackPayload?.transcript === 'string' ? fallbackPayload.transcript.trim() : ''
    }

    const payload = (await response.json()) as { transcript?: string }
    return typeof payload?.transcript === 'string' ? payload.transcript.trim() : ''
  } finally {
    window.clearTimeout(timeoutId)
  }
}

declare global {
  interface Window {
    electron: typeof electronAPI
    api: typeof api
    totemVoz?: {
      transcrever: (audioBase64: string) => Promise<string>
    }
    totemGov?: {
      close: (action?: "back" | "exit") => Promise<{ success: boolean }>
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

const totemGovApi = {
  close: (action?: 'back' | 'exit') => ipcRenderer.invoke('totem-gov-close', action)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('totem', totemApi)
    contextBridge.exposeInMainWorld('totemGov', totemGovApi)

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
  } catch (error) {
    console.error('[preload] erro ao expor APIs:', error)
  }
} else {
  window.electron = electronAPI
  window.api = api
  window.totem = totemApi
  window.totemGov = totemGovApi

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

  console.log('[preload] APIs do totem registradas')
}
