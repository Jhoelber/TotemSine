import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { START_URL } from '../config/constants'

const DEFAULT_ALLOWED_HOSTS = new Set([
  new URL(START_URL).hostname,
  'localhost',
  '127.0.0.1',
  'jacarezinho.govbr.cloud',
  'jacarezinho.pr.gov.br',
  'www.jacarezinho.pr.gov.br',
  'webapp1-jacarezinho.cidade360.cloud',
  'solucoes.receita.fazenda.gov.br',
  'jacarezinhocompramais.com.br',
  'portalcomprasjacarezinho.portyx.com.br',
  'duvidas-mei.vercel.app',
  'totemvoz.vercel.app',
  'servicos.mte.gov.br'
])

const DEFAULT_ALLOWED_PORTS = new Set(['', '80', '443', '8443', '5173'])

function resolveTrustedFileRoots() {
  const roots = new Set<string>()
  const appPath = app.getAppPath()
  roots.add(path.resolve(appPath, 'out', 'renderer'))
  roots.add(path.resolve(appPath, 'dist', 'renderer'))
  roots.add(path.resolve(app.getPath('userData'), 'viewer-cache'))
  return Array.from(roots)
}

function parseUrl(url: string) {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function isTrustedFileRendererUrl(url: string) {
  try {
    const filePath = path.resolve(fileURLToPath(url))
    return resolveTrustedFileRoots().some((root) => {
      const relative = path.relative(root, filePath)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    })
  } catch {
    return false
  }
}

export function isTrustedRendererUrl(url: string) {
  const parsed = parseUrl(url)
  if (!parsed) return false

  if (!['https:', 'http:', 'file:'].includes(parsed.protocol)) {
    return false
  }

  if (parsed.protocol === 'file:') {
    return isTrustedFileRendererUrl(url)
  }

  return DEFAULT_ALLOWED_HOSTS.has(parsed.hostname) && DEFAULT_ALLOWED_PORTS.has(parsed.port)
}

export function isTrustedAppOrigin(url: string) {
  const parsed = parseUrl(url)
  if (!parsed) return false

  const start = new URL(START_URL)
  return parsed.origin === start.origin || parsed.origin === 'http://localhost:5173'
}

export function isTrustedMediaOrigin(url: string) {
  return isTrustedAppOrigin(url)
}

export function assertTrustedRendererUrl(url: string, context: string) {
  if (isTrustedRendererUrl(url)) return
  throw new Error(`Origem nao autorizada para ${context}.`)
}
