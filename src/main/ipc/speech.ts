import { ipcMain } from "electron";
import { START_URL } from "../config/constants";
import { assertTrustedRendererUrl } from "../security/trustedOrigins";

const DEFAULT_SPEECH_API_URL = new URL("/api/speech-to-text", START_URL).toString();
const REQUEST_TIMEOUT_MS = 15000;

function resolveSpeechApiUrl() {
  const explicitUrl = process.env.TOTEM_SPEECH_API_URL?.trim();
  return explicitUrl || DEFAULT_SPEECH_API_URL;
}

async function fetchWithTimeout(input: string, init: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function registerSpeechIpc() {
  ipcMain.handle("totem-voz-transcrever", async (event, audioBase64: string) => {
    try {
      assertTrustedRendererUrl(event.senderFrame?.url || "", "transcrever audio");

      let content = String(audioBase64 || "").trim();
      let mimeType = "audio/webm";

      const commaIndex = content.indexOf(",");
      if (content.startsWith("data:") && commaIndex !== -1) {
        const meta = content.slice(5, commaIndex);
        mimeType = meta.split(";")[0] || mimeType;
        content = content.slice(commaIndex + 1);
      }

      if (!content) {
        return "";
      }

      const buffer = Buffer.from(content, "base64");
      console.log("[speech] audio recebido, bytes:", buffer.length);

      const response = await fetchWithTimeout(resolveSpeechApiUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audioBase64: content,
          mimeType,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Speech API HTTP ${response.status}: ${errorText}`);
      }

      const payload = (await response.json()) as { transcript?: string };
      return typeof payload?.transcript === "string" ? payload.transcript.trim() : "";
    } catch (error) {
      console.error("[speech] erro ao transcrever via API remota:", error);
      return "";
    }
  });
}
