import { app, BrowserWindow, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { START_URL } from "../config/constants";
import { isTrustedAppOrigin } from "../security/trustedOrigins";
import { openPdfInTotemViewer } from "../services/downloads";
import { getPrinterHealth, printPdfDefault } from "../services/printing";

const PRINT_TIMEOUT_MS = 20000;
const ALLOWED_PREVIEW_ORIGINS = new Set([
  new URL(START_URL).origin,
  "http://localhost:5173"
]);

function normalizePdfTarget(target: string) {
  if (!target) throw new Error("Arquivo PDF nao informado");

  if (/^file:\/\//i.test(target)) {
    return fileURLToPath(target);
  }

  return target;
}

function isAllowedPrintSender(senderUrl: string) {
  if (!senderUrl) return false;

  try {
    const normalized = senderUrl.replace(/#.*$/, "");
    const viewerPath = path.join(app.getPath("userData"), "viewer-cache", "pdf-viewer.html");
    const senderPath = /^file:\/\//i.test(normalized)
      ? path.resolve(fileURLToPath(normalized))
      : path.resolve(normalized);
    return senderPath.toLowerCase() === path.resolve(viewerPath).toLowerCase();
  } catch {
    return false;
  }
}

function isAllowedPreviewSender(senderUrl: string) {
  if (!senderUrl) return false;

  try {
    const sender = new URL(senderUrl);
    return ALLOWED_PREVIEW_ORIGINS.has(sender.origin);
  } catch {
    return false;
  }
}

async function validatePrintablePdf(pdfPath: string) {
  const resolvedPath = path.resolve(pdfPath);
  const downloadsDir = path.resolve(app.getPath("downloads"));
  const relative = path.relative(downloadsDir, resolvedPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Arquivo de impressao fora da pasta permitida.");
  }

  if (path.extname(resolvedPath).toLowerCase() !== ".pdf") {
    throw new Error("Somente arquivos PDF podem ser impressos.");
  }

  await fs.promises.access(resolvedPath, fs.constants.F_OK);
  return resolvedPath;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("A impressora demorou mais do que o esperado para responder."));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sanitizePdfBaseName(fileName: string) {
  const sanitized = (fileName || "curriculo")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim()
    .slice(0, 80);

  return sanitized || "curriculo";
}

function ensureUniqueOutputPath(fullPath: string) {
  if (!fs.existsSync(fullPath)) return fullPath;

  const ext = path.extname(fullPath);
  const base = fullPath.slice(0, -ext.length);
  return `${base}_${Date.now()}${ext}`;
}

async function createPdfFromHtml(html: string) {
  const sanitizedHtml = String(html || "").replace(
    /<script\b[^>]*>[\s\S]*?window\.print\s*\([\s\S]*?<\/script>/gi,
    ""
  );

  const previewWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(sanitizedHtml)}`);

    return await previewWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: "A4",
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
      }
    });
  } finally {
    if (!previewWindow.isDestroyed()) {
      previewWindow.destroy();
    }
  }
}

export function registerPrintIpc() {
  ipcMain.handle("totem-print-file-silent", async (event, payload?: { filePath?: string }) => {
    try {
      const senderUrl = event.senderFrame?.url || "";
      if (!isAllowedPrintSender(senderUrl)) {
        throw new Error("Origem nao autorizada para impressao.");
      }

      const rawTarget = payload?.filePath || "";
      const pdfPath = await validatePrintablePdf(normalizePdfTarget(rawTarget));

      await withTimeout(printPdfDefault(pdfPath), PRINT_TIMEOUT_MS);
      await fs.promises.unlink(pdfPath).catch((error: NodeJS.ErrnoException) => {
        if (error?.code !== "ENOENT") throw error;
      });

      return { success: true };
    } catch (error) {
      console.error("[print-file-silent] erro ao imprimir PDF:", error);

      return {
        success: false,
        failureReason: error instanceof Error ? error.message : "Falha ao imprimir PDF"
      };
    }
  });

  ipcMain.handle("totem-printer-status", async (event) => {
    try {
      if (!isTrustedAppOrigin(event.senderFrame?.url || "")) {
        throw new Error("Origem nao autorizada para consultar impressora.");
      }

      return await getPrinterHealth();
    } catch (error) {
      console.error("[printer-status] erro ao consultar impressora:", error);
      return {
        available: false,
        message: error instanceof Error ? error.message : "Nao foi possivel consultar a impressora."
      };
    }
  });

  ipcMain.handle(
    "totem-open-pdf-preview-from-html",
    async (event, payload?: { html?: string; fileName?: string }) => {
      try {
        const senderUrl = event.senderFrame?.url || "";
        if (!isAllowedPreviewSender(senderUrl)) {
          throw new Error("Origem nao autorizada para gerar PDF.");
        }

        const html = String(payload?.html || "").trim();
        if (!html) {
          throw new Error("Conteudo HTML do PDF nao informado.");
        }

        const fileName = `${sanitizePdfBaseName(String(payload?.fileName || "curriculo"))}.pdf`;
        const downloadsDir = app.getPath("downloads");
        const outputPath = ensureUniqueOutputPath(path.join(downloadsDir, fileName));
        const pdfBuffer = await createPdfFromHtml(html);

        await fs.promises.writeFile(outputPath, pdfBuffer);

        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        if (!browserWindow) {
          throw new Error("Janela principal do totem nao encontrada.");
        }

        await openPdfInTotemViewer(browserWindow, outputPath);

        return { success: true, filePath: outputPath };
      } catch (error) {
        console.error("[open-pdf-preview-from-html] erro ao gerar preview:", error);
        return {
          success: false,
          failureReason:
            error instanceof Error ? error.message : "Nao foi possivel gerar o PDF do curriculo."
        };
      }
    }
  );
}
