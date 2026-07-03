import type { BrowserWindow } from 'electron'
import { session } from 'electron'
import { logSecurityError, logSecurityInfo } from './securityLog'

async function clearRendererStorage(mainWindow: BrowserWindow) {
  if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

  await mainWindow.webContents
    .executeJavaScript(
      `
        (async () => {
          try {
            try { localStorage.clear(); } catch {}
            try { sessionStorage.clear(); } catch {}

            try {
              if ('caches' in window) {
                const cacheKeys = await caches.keys();
                await Promise.all(cacheKeys.map((key) => caches.delete(key)));
              }
            } catch {}

            try {
              if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((registration) => registration.unregister()));
              }
            } catch {}

            try {
              if (indexedDB && typeof indexedDB.databases === 'function') {
                const databases = await indexedDB.databases();
                await Promise.all(
                  databases
                    .map((database) => database?.name)
                    .filter(Boolean)
                    .map((name) => new Promise((resolve) => {
                      const request = indexedDB.deleteDatabase(name);
                      request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
                    }))
                );
              }
            } catch {}
          } catch {}
        })();
      `,
      true
    )
    .catch(() => {})
}

export async function resetTotemSession(mainWindow?: BrowserWindow | null) {
  try {
    if (mainWindow) {
      await clearRendererStorage(mainWindow)
    }

    await session.defaultSession.clearStorageData({
      storages: [
        'cookies',
        'localstorage',
        'indexdb',
        'serviceworkers',
        'cachestorage',
        'filesystem',
        'shadercache',
        'websql'
      ]
    })

    await session.defaultSession.clearCache()
    await session.defaultSession.cookies.flushStore()
    logSecurityInfo('[session-reset] sessao limpa com sucesso')
  } catch (error) {
    logSecurityError('[session-reset] falha ao limpar sessao', error)
    throw error
  }
}
