import { ipcMain } from 'electron'
import { START_URL } from '../config/constants'
import { assertTrustedRendererUrl } from '../security/trustedOrigins'

const DEFAULT_SPEECH_API_URL = new URL('/api/speech-to-text', START_URL).toString()
const DEFAULT_VOICE_ASSISTANT_API_URL = new URL('/api/jobs-voice-assistant', START_URL).toString()
const JOBS_SNAPSHOT_URL = 'https://vagas.jacarezinho.cloud/api/v1/vagas-semana'
const REQUEST_TIMEOUT_MS = 15000

function resolveSpeechApiUrl() {
  const explicitUrl = process.env.TOTEM_SPEECH_API_URL?.trim()
  return explicitUrl || DEFAULT_SPEECH_API_URL
}

function resolveVoiceAssistantApiUrl() {
  const explicitUrl = process.env.TOTEM_SPEECH_FALLBACK_API_URL?.trim()
  return explicitUrl || DEFAULT_VOICE_ASSISTANT_API_URL
}

async function fetchWithTimeout(input: string, init: RequestInit) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchJobsSnapshot() {
  const response = await fetchWithTimeout(JOBS_SNAPSHOT_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
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

export function registerSpeechIpc() {
  ipcMain.handle('totem-voz-transcrever', async (event, audioBase64: string) => {
    try {
      assertTrustedRendererUrl(event.senderFrame?.url || '', 'transcrever audio')

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

      const buffer = Buffer.from(content, 'base64')
      console.log('[speech] audio recebido, bytes:', buffer.length)

      const response = await fetchWithTimeout(resolveSpeechApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audioBase64: content,
          mimeType
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        if (response.status !== 404) {
          throw new Error(`Speech API HTTP ${response.status}: ${errorText}`)
        }

        console.warn(
          '[speech] /api/speech-to-text nao encontrado, usando fallback /api/jobs-voice-assistant'
        )

        const snapshot = await fetchJobsSnapshot()
        const fallbackResponse = await fetchWithTimeout(resolveVoiceAssistantApiUrl(), {
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
          })
        })

        if (!fallbackResponse.ok) {
          const fallbackErrorText = await fallbackResponse.text()
          throw new Error(
            `Voice fallback API HTTP ${fallbackResponse.status}: ${fallbackErrorText}`
          )
        }

        const fallbackPayload = (await fallbackResponse.json()) as { transcript?: string }
        return typeof fallbackPayload?.transcript === 'string'
          ? fallbackPayload.transcript.trim()
          : ''
      }

      const payload = (await response.json()) as { transcript?: string }
      return typeof payload?.transcript === 'string' ? payload.transcript.trim() : ''
    } catch (error) {
      console.error('[speech] erro ao transcrever via API remota:', error)
      return ''
    }
  })
}
