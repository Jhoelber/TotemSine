// src/main/ipc/speech.ts
import { ipcMain } from 'electron'
import { createSpeechClient } from '../config/speech'
import { assertTrustedRendererUrl } from '../security/trustedOrigins'

export function registerSpeechIpc() {
  const speech = createSpeechClient()

  ipcMain.handle('totem-voz-transcrever', async (event, audioBase64: string) => {
    try {
      assertTrustedRendererUrl(event.senderFrame?.url || '', 'transcrever audio')

      if (!speech.available || !speech.speechClient) {
        return ''
      }

      let content = audioBase64
      const commaIndex = audioBase64.indexOf(',')
      if (audioBase64.startsWith('data:') && commaIndex !== -1) {
        content = audioBase64.slice(commaIndex + 1)
      }

      const buffer = Buffer.from(content, 'base64')
      console.log('Recebi áudio do totem, bytes:', buffer.length)

      const request: any = {
        config: {
          encoding: 'WEBM_OPUS' as any,
          sampleRateHertz: 48000,
          languageCode: 'pt-BR',
          enableAutomaticPunctuation: true
        },
        audio: { content }
      }

      const [response]: any = await speech.speechClient.recognize(request as any)
      const results = response.results ?? []
      if (!results.length) {
        console.log('Speech: nenhuma transcrição retornada.')
        return ''
      }

      const transcript = results
        .map((r: any) => r.alternatives?.[0]?.transcript ?? '')
        .join(' ')
        .trim()

      console.log('Transcrição:', transcript)
      return transcript
    } catch (err) {
      console.error('Erro ao transcrever com Google Speech:', err)
      return ''
    }
  })
}
