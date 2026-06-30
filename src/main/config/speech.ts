// src/main/config/speech.ts
import fs from 'fs'
import path from 'path'
import speech from '@google-cloud/speech'
import { app } from 'electron'

const REQUIRED_KEYS = [
  'GOOGLE_CLOUD_PROJECT_ID',
  'GOOGLE_CLOUD_CLIENT_EMAIL',
  'GOOGLE_CLOUD_PRIVATE_KEY'
] as const

function parseEnvFile(content: string) {
  const parsed: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    const hasDoubleQuotes = value.startsWith('"') && value.endsWith('"')
    const hasSingleQuotes = value.startsWith("'") && value.endsWith("'")
    if (hasDoubleQuotes || hasSingleQuotes) {
      value = value.slice(1, -1)
    }

    parsed[key] = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
  }

  return parsed
}

function resolveEnvCandidates() {
  const projectRootEnv = path.resolve(__dirname, '../../../.env')
  const cwdEnv = path.join(process.cwd(), '.env')
  const executableEnv = path.join(path.dirname(process.execPath), '.env')
  const resourcesEnv = path.join(process.resourcesPath, '.env')

  return Array.from(new Set([projectRootEnv, cwdEnv, executableEnv, resourcesEnv]))
}

function loadDotEnv() {
  for (const envPath of resolveEnvCandidates()) {
    if (!fs.existsSync(envPath)) continue

    const parsed = parseEnvFile(fs.readFileSync(envPath, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value
      }
    }

    return envPath
  }

  return null
}

function getRequiredEnv(name: (typeof REQUIRED_KEYS)[number]) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`)
  }

  return value
}

export function createSpeechClient() {
  const isDev = !app.isPackaged
  const envPath = loadDotEnv()

  const projectId = getRequiredEnv('GOOGLE_CLOUD_PROJECT_ID')
  const clientEmail = getRequiredEnv('GOOGLE_CLOUD_CLIENT_EMAIL')
  const privateKey = getRequiredEnv('GOOGLE_CLOUD_PRIVATE_KEY')

  const speechClient = new speech.SpeechClient({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey
    }
  })

  return { speechClient, isDev, envPath }
}
