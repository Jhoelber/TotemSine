import { BrowserWindow, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { ALLOWED_URLS_DOWNLOAD_OVERLAY, LIBRE_OFFICE_PATH, START_URL } from '../config/constants'

const libre = require('libreoffice-convert')
const pdfJsModuleUrl = pathToFileURL(require.resolve('pdfjs-dist/build/pdf.mjs')).toString()
const pdfJsWorkerUrl = pathToFileURL(require.resolve('pdfjs-dist/build/pdf.worker.mjs')).toString()

function sanitizeFilename(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

function ensureUniquePath(fullPath: string) {
  if (!fs.existsSync(fullPath)) return fullPath
  const ext = path.extname(fullPath)
  const base = fullPath.slice(0, -ext.length)
  return `${base}_${Date.now()}${ext}`
}

async function fileStartsWithPdfSignature(filePath: string) {
  try {
    const fd = await fs.promises.open(filePath, 'r')
    const bytes = new Uint8Array(5)
    await fd.read(bytes, 0, 5, 0)
    await fd.close()
    return Buffer.from(bytes).toString('utf8') === '%PDF-'
  } catch {
    return false
  }
}

async function inferDownloadedType(fullPath: string, mime: string) {
  const ext = path.extname(fullPath).toLowerCase()

  if (mime === 'application/pdf') return 'pdf'
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'doc'
  }

  if (ext === '.pdf') return 'pdf'
  if (ext === '.doc' || ext === '.docx') return 'doc'
  if (await fileStartsWithPdfSignature(fullPath)) return 'pdf'

  return 'other'
}

export function registerDownloads(mainWindow: BrowserWindow) {
  libre._libreOfficePath = LIBRE_OFFICE_PATH

  const sessAny = mainWindow.webContents.session as any
  if (sessAny.__LPX_WILL_DOWNLOAD__) return
  sessAny.__LPX_WILL_DOWNLOAD__ = true

  mainWindow.webContents.session.on('will-download', (_event, item) => {
    const anyItem = item as any
    const mime: string = anyItem.getMimeType?.() || ''
    const url: string = anyItem.getURL?.() || ''

    let fileName: string = anyItem.getFilename?.() || `download_${Date.now()}`
    fileName = sanitizeFilename(fileName)

    if (mime === 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) {
      fileName += '.pdf'
    }

    const downloadsDir = app.getPath('downloads')
    let fullPath = ensureUniquePath(path.join(downloadsDir, fileName))

    item.setSavePath(fullPath)

    console.log('[will-download]', { url, mime, fileName, fullPath })

    item.on('done', async (_e, state) => {
      console.log('[download done]', state, fullPath)

      if (state !== 'completed') {
        console.error('Download falhou:', state)
        return
      }

      try {
        await fs.promises.access(fullPath)

        const currentUrl = mainWindow.webContents.getURL()
        const shouldOverlay = ALLOWED_URLS_DOWNLOAD_OVERLAY.some((u) => currentUrl.startsWith(u))

        if (shouldOverlay) showOverlay(mainWindow)

        const type = await inferDownloadedType(fullPath, mime)
        console.log('[download inferredType]', type)

        if (type === 'pdf' && !fullPath.toLowerCase().endsWith('.pdf')) {
          const withExt = ensureUniquePath(fullPath + '.pdf')
          try {
            await fs.promises.rename(fullPath, withExt)
            fullPath = withExt
            console.log('[download renamed to]', fullPath)
          } catch (error) {
            console.warn('Nao consegui renomear para .pdf, vou tentar abrir assim mesmo:', error)
          }
        }

        if (type === 'pdf') {
          await openPdfInTotemViewer(mainWindow, fullPath)
        } else if (type === 'doc') {
          const pdfPath = await convertDocToPdf(fullPath)
          await openPdfInTotemViewer(mainWindow, pdfPath)
        } else {
          console.log('Arquivo baixado (nao PDF/DOC).', fullPath)
        }

        if (shouldOverlay) removeOverlay(mainWindow)
      } catch (error) {
        console.error('Erro pos-download:', error)
        try {
          removeOverlay(mainWindow)
        } catch {}
      }
    })
  })
}

export async function openPdfInTotemViewer(mainWindow: BrowserWindow, caminhoDoPDF: string) {
  try {
    const viewerPath = await ensurePdfViewerFile(caminhoDoPDF)
    console.log('[open-pdf custom-viewer]', viewerPath)
    await mainWindow.loadFile(viewerPath, { hash: 'lpx-pdf-viewer' })
  } catch (error) {
    console.error('Falha ao abrir PDF no visualizador customizado:', error)
  }
}

async function ensurePdfViewerFile(pdfPath: string) {
  const viewerDir = path.join(app.getPath('userData'), 'viewer-cache')
  await fs.promises.mkdir(viewerDir, { recursive: true })

  const viewerPath = path.join(viewerDir, 'pdf-viewer.html')
  const pdfBuffer = await fs.promises.readFile(pdfPath)
  const pdfBase64 = pdfBuffer.toString('base64')
  const html = createPdfViewerHtml(pdfBase64, pdfPath)

  await fs.promises.writeFile(viewerPath, html, 'utf8')
  return viewerPath
}

function createPdfViewerHtml(pdfBase64: string, pdfPath: string) {
  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'self' 'unsafe-inline' data: blob: file:; script-src 'self' 'unsafe-inline' data: blob: file:; worker-src 'self' blob: data: file:;"
        />
        <title>Visualizador PDF</title>
        <style>
          :root {
            --bg: #334155;
            --toolbar: rgba(17, 24, 39, 0.96);
            --panel: rgba(8, 47, 73, 0.94);
            --primary: #c62828;
            --primary-dark: #a61f1f;
            --text: #f8fafc;
            --muted: #cbd5e1;
          }

          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: var(--bg);
            color: var(--text);
          }

          .toolbar {
            position: sticky;
            top: 0;
            z-index: 10;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            padding: 14px 18px;
            background: var(--toolbar);
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
          }

          .title strong {
            display: block;
            font-size: 20px;
          }

          .title span {
            color: var(--muted);
            font-size: 14px;
          }

          .actions {
            display: flex;
            gap: 12px;
          }

          .actions button {
            border: 0;
            border-radius: 10px;
            padding: 12px 18px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
          }

          .btn-secondary {
            background: #e5e7eb;
            color: #111827;
          }

          .btn-primary {
            background: var(--primary);
            color: white;
          }

          .btn-primary[disabled],
          .btn-secondary[disabled] {
            opacity: 0.6;
            cursor: wait;
          }

          .btn-primary:active {
            background: var(--primary-dark);
          }

          .hint, .status {
            margin: 14px auto 0;
            width: fit-content;
            max-width: calc(100vw - 32px);
            padding: 12px 18px;
            text-align: center;
            color: white;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
          }

          .hint {
            border-radius: 999px;
            background: var(--panel);
            font-size: 18px;
            font-weight: 700;
          }

          .status {
            display: none;
            border-radius: 14px;
            background: rgba(17, 24, 39, 0.94);
            font-size: 16px;
            font-weight: 600;
          }

          .status-actions {
            display: none;
            justify-content: center;
            gap: 12px;
            margin-top: 14px;
          }

          .status-actions.is-visible {
            display: flex;
          }

          .status-actions button {
            border: 0;
            border-radius: 12px;
            padding: 12px 18px;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
          }

          .print-overlay {
            position: fixed;
            inset: 0;
            z-index: 30;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(15, 23, 42, 0.38);
            backdrop-filter: blur(2px);
          }

          .print-overlay.is-visible {
            display: flex;
          }

          .print-card {
            min-width: 320px;
            max-width: calc(100vw - 48px);
            padding: 28px 30px;
            border-radius: 20px;
            background: rgba(17, 24, 39, 0.96);
            color: white;
            text-align: center;
            box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
          }

          .print-spinner {
            width: 54px;
            height: 54px;
            margin: 0 auto 16px;
            border-radius: 50%;
            border: 5px solid rgba(255, 255, 255, 0.18);
            border-top-color: #f8fafc;
            animation: lpx-spin 0.9s linear infinite;
          }

          .print-card strong {
            display: block;
            font-size: 26px;
            margin-bottom: 8px;
          }

          .print-card span {
            display: block;
            font-size: 18px;
            color: #cbd5e1;
          }

          .print-card button {
            margin-top: 18px;
            border: 0;
            border-radius: 12px;
            padding: 12px 18px;
            background: #e5e7eb;
            color: #111827;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
          }

          @keyframes lpx-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }

          .viewer {
            padding: 22px 18px 40px;
          }

          .page-shell {
            margin: 0 auto 18px;
            width: fit-content;
            background: white;
            padding: 10px;
            border-radius: 6px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
          }

          canvas {
            display: block;
            background: white;
          }

          .loading {
            padding: 48px 18px;
            text-align: center;
            font-size: 18px;
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <div class="title">
            <strong>Visualizador do PDF</strong>
            <span>Use o botao Imprimir para enviar direto a impressora padrao.</span>
          </div>
          <div class="actions">
            <button class="btn-secondary" id="back-btn">Voltar</button>
            <button class="btn-primary" id="print-btn">Imprimir</button>
            <button class="btn-secondary" id="exit-btn">Sair</button>
          </div>
        </div>

        <div class="hint">Seu PDF foi aberto. Clique em Imprimir para continuar.</div>
        <div class="status" id="print-status"></div>
        <div class="status-actions" id="print-status-actions">
          <button class="btn-primary" id="retry-print-btn">Tentar novamente</button>
          <button class="btn-secondary" id="return-print-btn">Voltar</button>
        </div>
        <div class="print-overlay" id="print-overlay">
          <div class="print-card">
            <div class="print-spinner"></div>
            <strong>Enviando para impressora</strong>
            <span>Aguarde um momento...</span>
            <button id="cancel-print-btn">Cancelar</button>
          </div>
        </div>
        <div class="viewer" id="viewer-root">
          <div class="loading" id="loading">Carregando PDF...</div>
        </div>

        <script type="module">
          import * as pdfjsLib from ${JSON.stringify(pdfJsModuleUrl)};
          const pdfBase64 = ${JSON.stringify(pdfBase64)};
          const pdfPath = ${JSON.stringify(pdfPath)};
          const startUrl = ${JSON.stringify(START_URL)};
          const root = document.getElementById('viewer-root');
          const loading = document.getElementById('loading');
          const status = document.getElementById('print-status');
          const printButton = document.getElementById('print-btn');
          const backButton = document.getElementById('back-btn');
          const exitButton = document.getElementById('exit-btn');
          const printOverlay = document.getElementById('print-overlay');
          const cancelPrintButton = document.getElementById('cancel-print-btn');
          const retryPrintButton = document.getElementById('retry-print-btn');
          const returnPrintButton = document.getElementById('return-print-btn');
          const printStatusActions = document.getElementById('print-status-actions');
          let isPrinting = false;
          let printCompleted = false;
          let activePrintAttempt = 0;
          let lastPrintInteractionAt = 0;

          pdfjsLib.GlobalWorkerOptions.workerSrc = ${JSON.stringify(pdfJsWorkerUrl)};

          document.getElementById('back-btn')?.addEventListener('click', () => {
            if (history.length > 1) {
              history.back();
            } else {
              window.location.replace(startUrl);
            }
          });

          document.getElementById('exit-btn')?.addEventListener('click', () => {
            window.location.replace(startUrl);
          });

          function setPrintingState(active) {
            isPrinting = active;

            if (printButton) {
              printButton.disabled = active;
              printButton.textContent = active ? 'Imprimindo...' : 'Imprimir';
            }

            if (backButton) backButton.disabled = active;
            if (exitButton) exitButton.disabled = active;
            if (printOverlay) {
              printOverlay.classList.toggle('is-visible', active);
            }

            if (status) {
              if (active) {
                status.textContent = 'Enviando para impressora...';
                status.style.display = 'block';
              }
            }

            if (printStatusActions && active) {
              printStatusActions.classList.remove('is-visible');
            }
          }

          function showTemporaryStatus(message, duration) {
            if (!status) return;
            status.textContent = message;
            status.style.display = 'block';
            if (printStatusActions) {
              printStatusActions.classList.remove('is-visible');
            }
            window.setTimeout(() => {
              if (status.textContent === message) {
                status.style.display = 'none';
              }
            }, duration);
          }

          function showFriendlyPrintError(message) {
            if (status) {
              status.textContent = message;
              status.style.display = 'block';
            }

            if (printStatusActions) {
              printStatusActions.classList.add('is-visible');
            }
          }

          cancelPrintButton?.addEventListener('click', () => {
            if (!isPrinting) return;
            activePrintAttempt += 1;
            setPrintingState(false);
            showTemporaryStatus('Impressao cancelada na tela. Tente novamente se precisar.', 4500);
          });

          retryPrintButton?.addEventListener('click', () => {
            if (isPrinting || printCompleted) return;
            printStatusActions?.classList.remove('is-visible');
            triggerPrint();
          });

          returnPrintButton?.addEventListener('click', () => {
            if (isPrinting) return;
            if (history.length > 1) {
              history.back();
            } else {
              window.location.replace(startUrl);
            }
          });

          async function triggerPrint() {
            if (isPrinting || printCompleted) return;

            const now = Date.now();
            if (now - lastPrintInteractionAt < 1500) return;
            lastPrintInteractionAt = now;

            try {
              if (!window.totem || !window.totem.printFileSilent) {
                throw new Error('API de impressao nao esta disponivel nesta tela.');
              }

              activePrintAttempt += 1;
              const attemptId = activePrintAttempt;
              setPrintingState(true);
              const result = await window.totem.printFileSilent(pdfPath);
              if (attemptId !== activePrintAttempt) return;
              if (!status) return;

              status.textContent = result?.success
                ? 'Documento enviado para impressora.'
                : (result?.failureReason || 'Nao foi possivel imprimir o PDF.');
              status.style.display = 'block';
              if (result?.success) {
                printCompleted = true;
                if (printButton) {
                  printButton.disabled = true;
                  printButton.textContent = 'Impresso';
                }
                window.setTimeout(() => {
                  window.location.replace(startUrl);
                }, 2200);
              } else {
                showFriendlyPrintError(
                  'Nao foi possivel imprimir. Verifique a impressora e tente novamente.'
                );
              }
            } catch (error) {
              if (!status) return;
              if (!isPrinting) return;
              showFriendlyPrintError(
                error instanceof Error && error.message
                  ? error.message
                  : 'Nao foi possivel imprimir. Verifique a impressora e tente novamente.'
              );
            } finally {
              if (isPrinting) {
                setPrintingState(false);
              }
            }
          }

          printButton?.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void triggerPrint();
          });

          printButton?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
          });

          async function renderPdf() {
            try {
              if (!pdfjsLib) {
                throw new Error('pdfjsLib indisponivel');
              }

              const raw = window.atob(pdfBase64);
              const data = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i += 1) {
                data[i] = raw.charCodeAt(i);
              }

              const pdf = await pdfjsLib.getDocument({ data }).promise;
              if (loading) loading.remove();

              for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
                const page = await pdf.getPage(pageNumber);
                const viewport = page.getViewport({ scale: 1.3 });
                const shell = document.createElement('div');
                shell.className = 'page-shell';

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) continue;

                canvas.width = viewport.width;
                canvas.height = viewport.height;
                shell.appendChild(canvas);
                root.appendChild(shell);

                await page.render({ canvasContext: context, viewport }).promise;
              }
            } catch (error) {
              if (loading) {
                loading.textContent = 'Nao foi possivel carregar o PDF.';
              }
              console.error('[pdf-viewer] erro ao renderizar PDF:', error);
            }
          }

          renderPdf();
        </script>
      </body>
    </html>
  `
}

async function convertDocToPdf(inputPath: string) {
  const outputPath = inputPath.replace(/\.(docx|doc)$/i, '.pdf')
  const docBuffer = await fs.promises.readFile(inputPath)

  const convertedBuffer = await new Promise<Buffer>((resolve, reject) => {
    libre.convert(docBuffer, '.pdf', undefined, (err: any, done: any) => {
      if (err) return reject(err)
      resolve(done as Buffer)
    })
  })

  const bytes = Uint8Array.from(convertedBuffer)
  await fs.promises.writeFile(outputPath, bytes)

  return outputPath
}

function showOverlay(mainWindow: BrowserWindow) {
  mainWindow.webContents
    .insertCSS(
      `
      #loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: rgba(255, 255, 255, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
      }

      #loading-overlay .spinner {
        border: 4px solid #f3f3f3;
        border-top: 4px solid #3498db;
        border-radius: 50%;
        width: 50px;
        height: 50px;
        animation: spin 2s linear infinite;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `
    )
    .catch(() => {})

  mainWindow.webContents
    .executeJavaScript(
      `
      if (!document.getElementById('loading-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'loading-overlay';

        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        overlay.appendChild(spinner);

        const texto = document.createElement('div');
        texto.className = 'texto';
        texto.innerText = 'Aguarde um momento, estou convertendo seu documento em PDF';
        texto.style.cssText = 'margin-left:1em; color:black;background-color: rgba(255, 255, 255, 0.8); padding:2em;';
        overlay.appendChild(texto);

        document.body.appendChild(overlay);
      }
    `
    )
    .catch(() => {})
}

function removeOverlay(mainWindow: BrowserWindow) {
  mainWindow.webContents
    .executeJavaScript(
      `
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.remove();
    `
    )
    .catch(() => {})
}
