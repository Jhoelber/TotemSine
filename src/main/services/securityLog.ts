import { app } from 'electron'
import log from 'electron-log'

const securityLog = log.scope('security')

log.transports.file.level = 'info'
log.transports.console.level = app.isPackaged ? false : 'info'

function normalizeMeta(meta?: unknown) {
  if (meta === undefined) return undefined
  if (meta instanceof Error) {
    return {
      name: meta.name,
      message: meta.message,
      stack: meta.stack
    }
  }
  return meta
}

export function logSecurityInfo(message: string, meta?: unknown) {
  securityLog.info(message, normalizeMeta(meta))
}

export function logSecurityWarn(message: string, meta?: unknown) {
  securityLog.warn(message, normalizeMeta(meta))
}

export function logSecurityError(message: string, meta?: unknown) {
  securityLog.error(message, normalizeMeta(meta))
}
