// src/main/services/connectivity.ts
import type { BrowserWindow } from 'electron'
import { SINE_ICONS } from './sineUi'

export function registerConnectivity(mainWindow: BrowserWindow) {
  // tela cheia no padrao SINE; volta sozinha quando a internet retorna
  const offlineMessageScript = `
    const existing = document.getElementById('offline-message');
    if (!existing) {
      const offlineMessage = document.createElement('div');
      offlineMessage.id = 'offline-message';
      offlineMessage.setAttribute('role', 'alert');
      offlineMessage.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:9999',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'background:rgba(12,50,111,0.55)',
        'font-family:"Public Sans","Segoe UI",system-ui,Arial,sans-serif'
      ].join(';');
      offlineMessage.innerHTML = ${JSON.stringify(`
        <div style="display:flex;flex-direction:column;align-items:center;gap:18px;max-width:720px;padding:48px 56px;border-radius:32px;background:#fff;border-top:8px solid #FFCD07;text-align:center;">
          <div style="display:grid;place-items:center;width:104px;height:104px;border-radius:50%;background:#E5EEFB;color:#1351B4;">
            ${SINE_ICONS.semRede.replace('<svg ', '<svg width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ')}
          </div>
          <strong style="font-size:38px;font-weight:900;color:#0C326F;">Sem conexão com a internet</strong>
          <span style="font-size:24px;line-height:1.45;color:#555F6D;">Estamos tentando reconectar. Assim que a internet voltar, a tela abre sozinha. Se demorar, procure o balcão do SINE.</span>
        </div>
      `)};
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
