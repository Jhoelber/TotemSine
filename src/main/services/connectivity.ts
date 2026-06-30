// src/main/services/connectivity.ts
import type { BrowserWindow } from 'electron'

export function registerConnectivity(mainWindow: BrowserWindow) {
  const offlineMessageScript = `
    const existing = document.getElementById('offline-message');
    if (!existing) {
      const offlineMessage = document.createElement('div');
      offlineMessage.innerHTML = '<div style="display:flex;align-items:center;"><span>Sem Internet</span></div>';
      offlineMessage.style.color = 'white';
      offlineMessage.style.background = 'rgba(0, 0, 0, 0.8)';
      offlineMessage.style.padding = '20px';
      offlineMessage.style.borderRadius = '10px';
      offlineMessage.style.position = 'fixed';
      offlineMessage.style.top = '50%';
      offlineMessage.style.left = '50%';
      offlineMessage.style.transform = 'translate(-50%, -50%)';
      offlineMessage.style.fontSize = '24px';
      offlineMessage.style.fontWeight = 'bold';
      offlineMessage.style.textAlign = 'center';
      offlineMessage.style.zIndex = '9999';
      offlineMessage.id = 'offline-message';
      document.body.appendChild(offlineMessage);
    }
  `

  const onlineScript = `
    const offlineMessage = document.getElementById('offline-message');
    if (offlineMessage) {
      offlineMessage.remove();
      location.reload();
    }
  `

  function inject() {
    mainWindow.webContents.executeJavaScript(`
      window.addEventListener('online', () => { ${onlineScript} });
      window.addEventListener('offline', () => { ${offlineMessageScript} });

      if (!navigator.onLine) { ${offlineMessageScript} }
    `)
  }

  mainWindow.webContents.on('did-finish-load', inject)
  inject()
}
