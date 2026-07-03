import type { BrowserWindow } from 'electron'
import { isGovSensitiveUrl, openGovWindow } from './govWindow'

const ALLOWED_HOSTS = new Set([
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

const BLOCKED_HOSTS = new Set(['get.adobe.com'])
const ALLOWED_PORTS = new Set(['', '443', '80', '8443'])
const FLAG = '__LPX_OPEN_REGISTERED__' as const

function isBlocked(url: string) {
  try {
    const u = new URL(url)
    return BLOCKED_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

function isHttp(url: string) {
  return /^https?:\/\//i.test(url || '')
}

function isAllowedHttp(url: string) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (!ALLOWED_HOSTS.has(u.hostname)) return false
    if (!ALLOWED_PORTS.has(u.port)) return false
    return true
  } catch {
    return false
  }
}

function isPdfLike(url: string) {
  const u = (url || '').toLowerCase()

  return (
    u.includes('/cidadao/download.jsp') ||
    u.includes('download.jsp') ||
    u.includes('/cidadao/servlet/br.com.cetil.ar.jvlle.hdownload') ||
    u.includes('hdownload') ||
    u.endsWith('.pdf') ||
    u.includes('contenttype=application/pdf') ||
    u.includes('application/pdf')
  )
}

async function patchWindowOpenToSameTab(mainWindow: BrowserWindow) {
  try {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

    const script = `
      (() => {
        if (window.__LPX_OPEN_PATCHED__) return;
        window.__LPX_OPEN_PATCHED__ = true;

        function isCurriculoRapidoRoute() {
          try {
            const href = String(window.location.href || "").toLowerCase();
            return href.includes("#/curriculo-rapido");
          } catch {
            return false;
          }
        }

        function stripAutoPrintScripts(html) {
          return String(html || "").replace(
            /<script\\b[^>]*>[\\s\\S]*?window\\.print\\s*\\([\\s\\S]*?<\\/script>/gi,
            ""
          );
        }

        function inferPreviewFileName(html) {
          try {
            const titleMatch = String(html || "").match(/<title>(.*?)<\\/title>/i);
            const rawTitle = titleMatch && titleMatch[1] ? titleMatch[1] : "curriculo";
            return rawTitle
              .normalize("NFD")
              .replace(/[\\u0300-\\u036f]/g, "")
              .replace(/[^a-zA-Z0-9\\-_ ]/g, " ")
              .trim()
              .replace(/\\s+/g, "-")
              .toLowerCase() || "curriculo";
          } catch {
            return "curriculo";
          }
        }

        function createPdfPreviewProxy() {
          let htmlBuffer = "";

          return {
            closed: false,
            focus() {},
            close() {
              this.closed = true;
            },
            document: {
              write(chunk) {
                htmlBuffer += String(chunk || "");
              },
              close() {
                const sanitizedHtml = stripAutoPrintScripts(htmlBuffer);

                if (!window.totem || !window.totem.openPdfPreviewFromHtml) {
                  console.warn("[LPX] API de preview PDF nao disponivel.");
                  return;
                }

                window.totem
                  .openPdfPreviewFromHtml({
                    html: sanitizedHtml,
                    fileName: inferPreviewFileName(sanitizedHtml)
                  })
                  .catch((error) => {
                    console.error("[LPX] Falha ao abrir preview PDF:", error);
                  });
              }
            }
          };
        }

        window.open = function(url) {
          try {
            const u = String(url || "");
            if ((!u || u === "about:blank") && isCurriculoRapidoRoute()) {
              return createPdfPreviewProxy();
            }
            if (!u || u === "about:blank") return window;
            window.location.assign(u);
            return window;
          } catch {
            return null;
          }
        };

        document.addEventListener("click", function(e) {
          try {
            var t = e.target;
            if (!(t instanceof Element)) return;

            var a = t.closest('a[target="_blank"]');
            if (a && a.href) {
              e.preventDefault();
              window.location.assign(a.href);
            }
          } catch {}
        }, true);

        document.addEventListener("submit", function(e) {
          try {
            var f = e.target;
            if (f instanceof HTMLFormElement && f.target === "_blank") {
              f.target = "_self";
            }
          } catch {}
        }, true);

        try {
          var originalSubmit = HTMLFormElement.prototype.submit;
          HTMLFormElement.prototype.submit = function() {
            try {
              if (this && this.target === "_blank") this.target = "_self";
            } catch {}
            return originalSubmit.call(this);
          };
        } catch {}
      })();
    `

    await mainWindow.webContents.executeJavaScript(script, true).catch(() => {})
  } catch {
    // nunca deixa virar erro fatal
  }
}

export function registerOpenInSameWindow(mainWindow: BrowserWindow) {
  const wc = mainWindow.webContents as any
  if (wc[FLAG]) return
  wc[FLAG] = true

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (isGovSensitiveUrl(url)) {
      e.preventDefault()
      try {
        mainWindow.webContents.stop()
      } catch {}
      console.log('[gov-window] will-navigate interceptado', url)
      openGovWindow(mainWindow, url)
      return
    }

    if (isBlocked(url)) {
      e.preventDefault()
      console.log('[blocked will-navigate]', url)
      return
    }

    console.log('[will-navigate]', url)
  })

  mainWindow.webContents.on('will-redirect', (e, url) => {
    if (isGovSensitiveUrl(url)) {
      e.preventDefault()
      console.log('[gov-window] will-redirect interceptado', url)
      openGovWindow(mainWindow, url)
      return
    }

    if (isBlocked(url)) {
      e.preventDefault()
      console.log('[blocked will-redirect]', url)
    }
  })

  const patch = () => {
    void patchWindowOpenToSameTab(mainWindow)
  }

  mainWindow.webContents.on('dom-ready', patch)
  mainWindow.webContents.on('did-navigate', patch)
  mainWindow.webContents.on('did-navigate-in-page', patch)
  patch()

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isGovSensitiveUrl(url)) {
      console.log('[gov-window] window-open interceptado', url)
      openGovWindow(mainWindow, url)
      return { action: 'deny' }
    }

    if (isBlocked(url)) {
      console.log('[blocked window-open]', url)
      return { action: 'deny' }
    }

    const lower = (url || '').toLowerCase()
    console.log('[window-open]', url)

    if (!lower || lower === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: false,
          autoHideMenuBar: true
        }
      }
    }

    if (isPdfLike(url)) {
      try {
        mainWindow.webContents.downloadURL(url)
      } catch (e) {
        console.error('downloadURL falhou:', e)
      }
      return { action: 'deny' }
    }

    if (isHttp(url) && isAllowedHttp(url)) {
      void mainWindow.loadURL(url).catch((error) => {
        console.error('loadURL em mesma janela falhou:', error)
      })
      return { action: 'deny' }
    }

    console.warn('[denied window-open]', url)
    return { action: 'deny' }
  })
}
