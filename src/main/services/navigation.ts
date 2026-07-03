import type { BrowserWindow, WebFrameMain } from 'electron'
import { START_URL } from '../config/constants'

const NAVIGATION_SCRIPT = `
  (() => {
    function ensureSpeechRecognitionBridge() {
      if (window.__LPX_TOTEM_SPEECH_BRIDGE__) return;
      if (!window.totemVoz || typeof window.totemVoz.transcrever !== 'function') return;

      window.__LPX_TOTEM_SPEECH_BRIDGE__ = true;

      class TotemSpeechRecognition {
        constructor() {
          this.continuous = false;
          this.interimResults = false;
          this.lang = 'pt-BR';
          this.onstart = null;
          this.onend = null;
          this.onresult = null;
          this.onerror = null;
          this._stream = null;
          this._recorder = null;
          this._audioContext = null;
          this._chunks = [];
          this._frame = null;
          this._maxTimer = null;
          this._stopped = false;
        }

        async _transcribeAudio(base64, mimeType) {
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timeoutId = controller
            ? window.setTimeout(() => controller.abort(), 15000)
            : null;

          try {
            try {
              const response = await fetch(new URL('/api/speech-to-text', window.location.origin).toString(), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  audioBase64: base64,
                  mimeType
                }),
                signal: controller ? controller.signal : undefined
              });

              if (response.ok) {
                const payload = await response.json();
                const transcript = typeof payload?.transcript === 'string' ? payload.transcript.trim() : '';
                if (transcript) {
                  return transcript;
                }
              } else if (response.status === 404) {
                console.warn('[LPX speech] /api/speech-to-text nao encontrado, usando fallback /api/jobs-voice-assistant');

                const jobsResponse = await fetch('https://vagas.jacarezinho.cloud/api/v1/vagas-semana', {
                  method: 'GET',
                  headers: {
                    Accept: 'application/json'
                  },
                  cache: 'no-store',
                  signal: controller ? controller.signal : undefined
                });

                if (!jobsResponse.ok) {
                  throw new Error('Jobs snapshot HTTP ' + jobsResponse.status);
                }

                const jobsPayload = await jobsResponse.json();
                const jobs = Array.isArray(jobsPayload?.jobs)
                  ? jobsPayload.jobs.filter((job) => typeof job === 'string')
                  : [];

                const fallbackResponse = await fetch(
                  new URL('/api/jobs-voice-assistant', window.location.origin).toString(),
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      audioBase64: base64,
                      mimeType,
                      jobs,
                      publicationDate: String(jobsPayload?.publicationDate || ''),
                      updatedAt: String(jobsPayload?.updatedAt || '')
                    }),
                    signal: controller ? controller.signal : undefined
                  }
                );

                if (!fallbackResponse.ok) {
                  throw new Error('Voice fallback API HTTP ' + fallbackResponse.status);
                }

                const fallbackPayload = await fallbackResponse.json();
                const transcript = typeof fallbackPayload?.transcript === 'string'
                  ? fallbackPayload.transcript.trim()
                  : '';

                if (transcript) {
                  return transcript;
                }
              } else {
                console.warn('[LPX speech] fetch direto falhou:', response.status);
              }
            } catch (error) {
              console.warn('[LPX speech] fetch direto indisponivel, usando fallback bridge:', error);
            }

            if (window.totemVoz && typeof window.totemVoz.transcrever === 'function') {
              return String(await window.totemVoz.transcrever(base64) || '').trim();
            }

            return '';
          } finally {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          }
        }

        async start() {
          if (this._recorder && this._recorder.state === 'recording') return;

          try {
            this._stopped = false;
            this._chunks = [];

            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            });

            this._stream = stream;

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : 'audio/webm';

            const recorder = new MediaRecorder(stream, { mimeType });
            this._recorder = recorder;

            recorder.ondataavailable = (event) => {
              if (event.data && event.data.size > 0) {
                this._chunks.push(event.data);
              }
            };

            recorder.onerror = () => {
              this._finishError('audio-capture');
            };

            recorder.onstop = async () => {
              const blob = new Blob(this._chunks, { type: recorder.mimeType || 'audio/webm' });
              this._cleanupMedia();

              if (this._stopped) {
                this._emitEnd();
                return;
              }

              if (!blob.size) {
                this._finishError('no-speech');
                return;
              }

              try {
                const base64 = await this._blobToBase64(blob);
                const transcript = await this._transcribeAudio(base64, recorder.mimeType || 'audio/webm');

                if (!transcript) {
                  this._finishError('no-speech');
                  return;
                }

                if (typeof this.onresult === 'function') {
                  this.onresult({
                    results: [
                      [
                        {
                          transcript
                        }
                      ]
                    ]
                  });
                }

                this._emitEnd();
              } catch (_error) {
                this._finishError('network');
              }
            };

            recorder.start();
            this._startSilenceDetection(stream);

            this._maxTimer = window.setTimeout(() => {
              this.stop();
            }, 7000);

            if (typeof this.onstart === 'function') {
              this.onstart();
            }
          } catch (_error) {
            this._finishError('not-allowed');
          }
        }

        stop() {
          this._stopped = false;
          this._stopRecorder();
        }

        abort() {
          this._stopped = true;
          this._stopRecorder();
          this._cleanupMedia();
          this._emitEnd();
        }

        _stopRecorder() {
          if (this._recorder && this._recorder.state === 'recording') {
            this._recorder.stop();
          }
        }

        _emitEnd() {
          this._clearTimers();
          if (typeof this.onend === 'function') {
            this.onend();
          }
        }

        _finishError(code) {
          this._clearTimers();
          this._cleanupMedia();
          if (typeof this.onerror === 'function') {
            this.onerror({ error: code });
          }
          this._emitEnd();
        }

        _clearTimers() {
          if (this._frame) {
            cancelAnimationFrame(this._frame);
            this._frame = null;
          }

          if (this._maxTimer) {
            clearTimeout(this._maxTimer);
            this._maxTimer = null;
          }
        }

        _cleanupMedia() {
          this._clearTimers();

          if (this._stream) {
            this._stream.getTracks().forEach((track) => track.stop());
            this._stream = null;
          }

          if (this._audioContext && this._audioContext.state !== 'closed') {
            this._audioContext.close().catch(() => {});
          }

          this._audioContext = null;
          this._recorder = null;
        }

        _blobToBase64(blob) {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result;
              if (typeof result !== 'string') {
                reject(new Error('invalid-audio'));
                return;
              }

              const base64 = result.split(',')[1];
              if (!base64) {
                reject(new Error('empty-audio'));
                return;
              }

              resolve(base64);
            };
            reader.onerror = () => reject(new Error('read-failed'));
            reader.readAsDataURL(blob);
          });
        }

        _startSilenceDetection(stream) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) return;

          const audioContext = new AudioContextClass();
          const analyser = audioContext.createAnalyser();
          const source = audioContext.createMediaStreamSource(stream);
          const dataArray = new Uint8Array(analyser.fftSize);

          analyser.fftSize = 2048;
          source.connect(analyser);
          this._audioContext = audioContext;

          let startedSpeaking = false;
          let silenceStartedAt = null;
          const startedAt = Date.now();
          const minRecordingMs = 900;
          const silenceLimitMs = 1100;

          const checkVolume = () => {
            analyser.getByteTimeDomainData(dataArray);

            let sum = 0;
            for (const value of dataArray) {
              const normalized = (value - 128) / 128;
              sum += normalized * normalized;
            }

            const volume = Math.sqrt(sum / dataArray.length);
            const now = Date.now();
            const recordingTime = now - startedAt;
            const isSpeaking = volume > 0.018;

            if (isSpeaking) {
              startedSpeaking = true;
              silenceStartedAt = null;
            } else if (startedSpeaking && recordingTime > minRecordingMs) {
              if (!silenceStartedAt) {
                silenceStartedAt = now;
              }

              if (now - silenceStartedAt >= silenceLimitMs) {
                this.stop();
                return;
              }
            }

            this._frame = requestAnimationFrame(checkVolume);
          };

          checkVolume();
        }
      }

      window.SpeechRecognition = TotemSpeechRecognition;
      window.webkitSpeechRecognition = TotemSpeechRecognition;
    }

    function ensureAlertModal() {
      let overlay = document.getElementById('lpx-system-alert-overlay');
      if (overlay) return overlay;

      overlay = document.createElement('div');
      overlay.id = 'lpx-system-alert-overlay';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'display:none',
        'align-items:center',
        'justify-content:center',
        'z-index:2147483646',
        'background:rgba(15,23,42,0.36)',
        'backdrop-filter:blur(2px)'
      ].join(';');

      const card = document.createElement('div');
      card.style.cssText = [
        'width:min(560px, calc(100vw - 32px))',
        'padding:24px',
        'border-radius:18px',
        'background:#ffffff',
        'box-shadow:0 24px 60px rgba(0,0,0,0.26)',
        'text-align:center',
        'font-family:Arial,sans-serif'
      ].join(';');

      const title = document.createElement('strong');
      title.textContent = 'Aviso';
      title.style.cssText = [
        'display:block',
        'font-size:26px',
        'margin-bottom:12px',
        'color:#111827'
      ].join(';');

      const message = document.createElement('div');
      message.id = 'lpx-system-alert-message';
      message.style.cssText = [
        'font-size:22px',
        'line-height:1.45',
        'color:#1f2937',
        'margin-bottom:20px',
        'white-space:pre-wrap'
      ].join(';');

      const button = document.createElement('button');
      button.id = 'lpx-system-alert-ok';
      button.type = 'button';
      button.textContent = 'OK';
      button.style.cssText = [
        'border:0',
        'border-radius:12px',
        'padding:14px 28px',
        'background:#0f766e',
        'color:#fff',
        'font-size:18px',
        'font-weight:700',
        'cursor:pointer'
      ].join(';');

      card.appendChild(title);
      card.appendChild(message);
      card.appendChild(button);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      return overlay;
    }

    function patchDialogs() {
      if (window.__LPX_DIALOG_PATCHED__) return;
      window.__LPX_DIALOG_PATCHED__ = true;

      window.alert = function(message) {
        const overlay = ensureAlertModal();
        const messageNode = document.getElementById('lpx-system-alert-message');
        const button = document.getElementById('lpx-system-alert-ok');
        if (!overlay || !messageNode || !button) return;

        messageNode.textContent = String(message || 'Aviso');
        overlay.style.display = 'flex';

        const close = function() {
          overlay.style.display = 'none';
          button.removeEventListener('click', close);
        };

        button.addEventListener('click', close);
      };
    }

    function normalizeAssistantText(value) {
      return String(value || '')
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\\s]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    }

    function ensureAssistantTransitionOverlay() {
      let overlay = document.getElementById('lpx-assistant-transition-overlay');
      if (overlay) return overlay;

      overlay = document.createElement('div');
      overlay.id = 'lpx-assistant-transition-overlay';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'display:none',
        'align-items:center',
        'justify-content:center',
        'z-index:2147483645',
        'pointer-events:none',
        'background:radial-gradient(circle at center, rgba(255,255,255,0.18), rgba(224,242,254,0.10) 30%, rgba(15,23,42,0.14) 68%, rgba(15,23,42,0.22) 100%)',
        'backdrop-filter:blur(18px) saturate(1.05)',
        '-webkit-backdrop-filter:blur(18px) saturate(1.05)'
      ].join(';');

      const card = document.createElement('div');
      card.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:18px',
        'padding:18px 22px',
        'border-radius:24px',
        'background:linear-gradient(135deg, rgba(255,255,255,0.88), rgba(240,249,255,0.94))',
        'border:1px solid rgba(186,230,253,0.9)',
        'box-shadow:0 30px 70px rgba(15,23,42,0.14)',
        'backdrop-filter:blur(18px)',
        'transform:translateY(12px) scale(0.96)',
        'opacity:0',
        'transition:opacity 180ms ease, transform 220ms ease',
        'font-family:Arial,sans-serif',
        'max-width:min(560px, calc(100vw - 36px))'
      ].join(';');

      const icon = document.createElement('div');
      icon.style.cssText = [
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'width:56px',
        'height:56px',
        'border-radius:999px',
        'background:linear-gradient(135deg, #0ea5e9, #2563eb)',
        'box-shadow:0 0 0 6px rgba(186,230,253,0.42), 0 14px 34px rgba(37,99,235,0.24)',
        'color:#fff',
        'flex-shrink:0'
      ].join(';');
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="m13 5 7 7-7 7"></path></svg>';

      const textWrap = document.createElement('div');
      textWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

      const title = document.createElement('strong');
      title.id = 'lpx-assistant-transition-title';
      title.style.cssText = 'font-size:22px;color:#0f172a;line-height:1.15;';

      const subtitle = document.createElement('span');
      subtitle.id = 'lpx-assistant-transition-subtitle';
      subtitle.style.cssText = 'font-size:16px;color:#475569;line-height:1.45;';

      textWrap.appendChild(title);
      textWrap.appendChild(subtitle);
      card.appendChild(icon);
      card.appendChild(textWrap);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      overlay.__lpxCard = card;
      return overlay;
    }

    function showAssistantTransition(config) {
      const overlay = ensureAssistantTransitionOverlay();
      const card = overlay && overlay.__lpxCard;
      const title = document.getElementById('lpx-assistant-transition-title');
      const subtitle = document.getElementById('lpx-assistant-transition-subtitle');
      if (!overlay || !card || !title || !subtitle) return;

      title.textContent = config.title;
      subtitle.textContent = config.subtitle;
      overlay.style.display = 'flex';

      requestAnimationFrame(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0) scale(1)';
      });
    }

    function hideAssistantTransition() {
      const overlay = document.getElementById('lpx-assistant-transition-overlay');
      const card = overlay && overlay.__lpxCard;
      if (!overlay || !card) return;

      card.style.opacity = '0';
      card.style.transform = 'translateY(12px) scale(0.96)';
      window.setTimeout(() => {
        overlay.style.display = 'none';
      }, 220);
    }

    function getAssistantShortcutAction(label) {
      const normalized = normalizeAssistantText(label);
      if (!normalized) return null;

      if (
        normalized === 'ver vagas' ||
        normalized === 'ver todas as vagas' ||
        normalized === 'ver vaga' ||
        normalized === 'sim acessar vagas' ||
        normalized === 'sim ver vagas' ||
        normalized === 'sim quero ver vagas' ||
        normalized === 'quero ver as vagas disponiveis'
      ) {
        return {
          kind: 'internal',
          path: '/#/vagas',
          title: 'Abrindo vagas',
          subtitle: 'Voce sera direcionado para consultar as oportunidades disponiveis.'
        };
      }

      if (
        normalized === 'carteira digital' ||
        normalized === 'sim acessar carteira digital'
      ) {
        return {
          kind: 'external',
          href: 'https://servicos.mte.gov.br/spme-v2/#/login',
          target: '_blank',
          title: 'Abrindo Carteira Digital',
          subtitle: 'Vou encaminhar voce para o portal oficial do Gov.br.'
        };
      }

      if (
        normalized === 'curriculo rapido' ||
        normalized === 'sim acessar curriculo rapido'
      ) {
        return {
          kind: 'internal',
          path: '/#/curriculo-rapido',
          title: 'Abrindo curriculo rapido',
          subtitle: 'Voce podera preencher seus dados e gerar o curriculo em instantes.'
        };
      }

      if (normalized === 'voltar ao inicio') {
        return {
          kind: 'home',
          title: 'Voltando ao inicio',
          subtitle: 'Estou retornando para a tela principal do totem.'
        };
      }

      if (
        normalized === 'nao' ||
        normalized === 'não' ||
        normalized === 'agora nao' ||
        normalized === 'agora não' ||
        normalized === 'nao ver vagas' ||
        normalized === 'não ver vagas' ||
        normalized === 'fechar' ||
        normalized === 'cancelar'
      ) {
        return {
          kind: 'dismiss',
          title: 'Tudo bem',
          subtitle: 'Quando quiser, posso ajudar voce a acessar outra area do totem.'
        };
      }

      return null;
    }

    function runAssistantShortcut(action) {
      if (!action) return;

      function forceGoHome() {
        const startUrl = ${JSON.stringify(START_URL)};

        try {
          window.location.replace(startUrl);
        } catch {
          try {
            window.location.assign(startUrl);
          } catch {}
        }

        window.setTimeout(() => {
          try {
            if (window.location.href !== startUrl) {
              window.location.href = startUrl;
            }
          } catch {}
        }, 250);
      }

      async function resetToHomeWithFallback() {
        try {
          const result = await Promise.race([
            window.totem && typeof window.totem.resetToHome === 'function'
              ? window.totem.resetToHome()
              : Promise.resolve(null),
            new Promise((resolve) => window.setTimeout(() => resolve(null), 1800))
          ]);

          if (!result || !result.success) {
            forceGoHome();
          }
        } catch {
          forceGoHome();
        }
      }

      const closeButton = document.querySelector('button[aria-label="Fechar assistente"]');
      if (closeButton instanceof HTMLElement) {
        closeButton.click();
      } else if (window.location.hash === '#/assistente') {
        void resetToHomeWithFallback();
        return;
      }

      showAssistantTransition(action);

      window.setTimeout(() => {
        hideAssistantTransition();

        if (action.kind === 'internal') {
          const targetUrl = new URL(action.path, ${JSON.stringify(START_URL)}).toString();
          window.location.assign(targetUrl);
          return;
        }

        if (action.kind === 'external') {
          window.open(action.href, action.target || '_blank', 'noopener,noreferrer');
          return;
        }

        if (action.kind === 'home') {
          void resetToHomeWithFallback();
          return;
        }

        if (action.kind === 'dismiss') {
          return;
        }
      }, 1000);
    }

    function bindAssistantShortcutInterceptor() {
      if (window.__LPX_ASSISTANT_SHORTCUT_INTERCEPTOR__) return;
      window.__LPX_ASSISTANT_SHORTCUT_INTERCEPTOR__ = true;

      document.addEventListener(
        'click',
        (event) => {
          const trigger = event.target instanceof Element ? event.target.closest('button') : null;
          if (!trigger) return;
          if (!document.querySelector('button[aria-label="Fechar assistente"]')) return;

          const action = getAssistantShortcutAction(trigger.textContent || '');
          if (!action) return;

          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }

          runAssistantShortcut(action);
        },
        true
      );
    }

    let navigationContainer = document.getElementById('navigation-container');
    let backButton = document.getElementById('lpx-back-btn');
    let sairButton = document.getElementById('lpx-exit-btn');
    let downloadHint = document.getElementById('lpx-download-hint');

    patchDialogs();
    ensureSpeechRecognitionBridge();
    bindAssistantShortcutInterceptor();

    if (!navigationContainer) {
      navigationContainer = document.createElement('div');
      navigationContainer.id = 'navigation-container';
      navigationContainer.className = 'navigation-buttons';

      backButton = document.createElement('button');
      backButton.id = 'lpx-back-btn';
      backButton.innerText = 'Voltar';
      backButton.style.cssText =
        'background-color:#eee;border:0.5px solid #ccc;border-radius:7px;color:black;gap:10px;margin-right:5px;padding:8px 14px;font-size:12px;';
      backButton.addEventListener('click', () => {
        if (history.length > 1) window.history.back();
      });
      navigationContainer.appendChild(backButton);

      sairButton = document.createElement('button');
      sairButton.id = 'lpx-exit-btn';
      sairButton.innerText = 'Sair';
      sairButton.style.cssText =
        'background-color:#eee;border:0.5px solid #ccc;border-radius:7px;color:black;gap:10px;margin-right:2em;padding:8px 14px;font-size:12px;';
      sairButton.addEventListener('click', async () => {
        const START = ${JSON.stringify(START_URL)};
        const button = sairButton;

        function forceGoHome() {
          try {
            window.location.replace(START);
          } catch {
            try {
              window.location.assign(START);
            } catch {}
          }

          window.setTimeout(() => {
            try {
              if (window.location.href !== START) {
                window.location.href = START;
              }
            } catch {}
          }, 250);
        }

        if (button) {
          button.style.opacity = '0.7';
          button.style.pointerEvents = 'none';
        }

        try {
          const result = await Promise.race([
            window.totem && typeof window.totem.resetToHome === 'function'
              ? window.totem.resetToHome()
              : Promise.resolve(null),
            new Promise((resolve) => window.setTimeout(() => resolve(null), 1800))
          ]);

          if (!result || !result.success) {
            forceGoHome();
          }
        } catch {
          forceGoHome();
        } finally {
          window.setTimeout(() => {
            if (!button) return;
            button.style.opacity = '1';
            button.style.pointerEvents = 'auto';
          }, 2200);
        }
      });
      navigationContainer.appendChild(sairButton);

      document.body.appendChild(navigationContainer);
    }

    if (!downloadHint) {
      downloadHint = document.createElement('div');
      downloadHint.id = 'lpx-download-hint';
      downloadHint.className = 'lpx-download-hint';
      document.body.appendChild(downloadHint);
    }

    navigationContainer = document.getElementById('navigation-container');
    backButton = document.getElementById('lpx-back-btn');
    sairButton = document.getElementById('lpx-exit-btn');
    downloadHint = document.getElementById('lpx-download-hint');

    const href = window.location.href;
    const hrefL = (href || '').toLowerCase();
    let parsedUrl = null;
    try {
      parsedUrl = new URL(href);
    } catch {}
    const pathnameL = parsedUrl ? parsedUrl.pathname.toLowerCase() : '';
    const isLpxSineRoute =
      hrefL.startsWith('https://lpxsine.vercel.app/#/vagas') ||
      hrefL.startsWith('https://lpxsine.vercel.app/#/curriculo-rapido') ||
      pathnameL === '/vagas' ||
      pathnameL === '/curriculo-rapido' ||
      pathnameL === '/assistente';
    const isPdfLike =
      (hrefL.startsWith('file://') && hrefL.includes('.pdf')) ||
      hrefL.endsWith('.pdf') ||
      hrefL.includes('/cidadao/download.jsp') ||
      hrefL.includes('contenttype=application/pdf');

    const isJacarezinhoDownloadPage =
      hrefL.includes('br.com.cetil.ar.jvlle.hdownload') ||
      hrefL.startsWith('https://jacarezinho.govbr.cloud:8443/cidadao/servlet/') ||
      hrefL.startsWith('https://webapp1-jacarezinho.cidade360.cloud:8443/cidadao/servlet/');

    navigationContainer.style.top = '0';
    navigationContainer.style.left = '0';
    navigationContainer.style.right = 'auto';
    navigationContainer.style.bottom = 'auto';
    navigationContainer.style.width = '100%';
    navigationContainer.style.height = '60px';
    navigationContainer.style.justifyContent = 'space-between';
    navigationContainer.style.gap = '0';
    navigationContainer.style.backgroundColor = 'transparent';
    navigationContainer.style.padding = '10px';
    navigationContainer.style.borderRadius = '0';
    navigationContainer.style.marginTop = '0';
    navigationContainer.style.zIndex = '9999';
    navigationContainer.style.backdropFilter = '';
    navigationContainer.style.boxShadow = '';

    document.documentElement.classList.remove('lpx-sine-hash-route');
    document.body.classList.remove('lpx-sine-hash-route');

    if (sairButton) sairButton.style.marginRight = '2em';
    if (backButton) backButton.style.marginRight = '5px';
    if (downloadHint) {
      downloadHint.style.display = 'none';
      downloadHint.textContent = '';
    }

    if (
      hrefL.includes('https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp') ||
      hrefL.includes('https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_comprovante.asp') ||
      hrefL.includes('https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_qsa.asp')
    ) {
      navigationContainer.style.marginTop = '70px';
      navigationContainer.style.zIndex = '9999';
    } else if (
      hrefL.startsWith('https://jacarezinhocompramais.com.br/uploads/licitacao/') ||
      hrefL.startsWith('https://jacarezinhocompramais.com.br/uploads/pagina/arquivos/')
    ) {
      navigationContainer.style.backgroundColor = 'transparent';
      navigationContainer.style.marginTop = '40px';
      navigationContainer.style.zIndex = '0';
      if (sairButton) sairButton.style.marginRight = '4em';
    } else if (isPdfLike || isJacarezinhoDownloadPage) {
      if (downloadHint) {
        downloadHint.textContent = isJacarezinhoDownloadPage
          ? 'Clique em Download para visualizar seu PDF.'
          : 'Seu PDF foi aberto para visualizacao.';
        downloadHint.style.display = 'block';
      }

      navigationContainer.style.top = 'auto';
      navigationContainer.style.left = 'auto';
      navigationContainer.style.right = '16px';
      navigationContainer.style.bottom = '16px';
      navigationContainer.style.width = 'auto';
      navigationContainer.style.height = 'auto';
      navigationContainer.style.justifyContent = 'flex-start';
      navigationContainer.style.gap = '12px';
      navigationContainer.style.backgroundColor = 'rgba(0,0,0,0.15)';
      navigationContainer.style.padding = '10px 12px';
      navigationContainer.style.borderRadius = '12px';
      navigationContainer.style.zIndex = '9999';

      if (sairButton) sairButton.style.marginRight = '0';
      if (backButton) backButton.style.marginRight = '0';
    } else if (isLpxSineRoute) {
      document.documentElement.classList.add('lpx-sine-hash-route');
      document.body.classList.add('lpx-sine-hash-route');

      navigationContainer.style.backgroundColor = 'rgba(255,255,255,0.96)';
      navigationContainer.style.backdropFilter = 'blur(8px)';
      navigationContainer.style.boxShadow = '0 8px 24px rgba(15,23,42,0.08)';
    } else if (
      hrefL.startsWith('https://jacarezinhocompramais.com.br/') ||
      hrefL.startsWith('https://duvidas-mei.vercel.app') ||
      hrefL.startsWith('https://totemvoz.vercel.app')
    ) {
      navigationContainer.style.backgroundColor = '#05547D';
      navigationContainer.style.zIndex = '9999';
    }
  })();
`

const START_PAGE_SCRIPT = `
  (() => {
    let adminWarning = document.getElementById('lpx-admin-warning');

    if (!adminWarning) {
      adminWarning = document.createElement('div');
      adminWarning.id = 'lpx-admin-warning';
      adminWarning.className = 'lpx-admin-warning';
      adminWarning.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:20px',
        'transform:translateX(-50%)',
        'z-index:10001',
        'display:none',
        'max-width:min(860px, calc(100vw - 32px))',
        'padding:16px 20px',
        'border-radius:16px',
        'background:rgba(127,29,29,0.96)',
        'color:#fff',
        'font-size:18px',
        'font-weight:700',
        'text-align:center',
        'box-shadow:0 16px 36px rgba(0,0,0,0.25)'
      ].join(';');
      document.body.appendChild(adminWarning);
    }

    Promise.resolve()
      .then(() => window.totem?.getPrinterStatus?.())
      .then((printer) => {
        if (!adminWarning) return;

        if (!printer || printer.available) {
          adminWarning.style.display = 'none';
          adminWarning.textContent = '';
          return;
        }

        adminWarning.textContent = 'Aviso administrativo: impressora indisponivel. Verifique a impressora antes de atender o proximo usuario.';
        adminWarning.style.display = 'block';
      })
      .catch(() => {
        if (!adminWarning) return;
        adminWarning.textContent = 'Aviso administrativo: nao foi possivel validar a impressora.';
        adminWarning.style.display = 'block';
      });
  })();
`

async function injectScriptIntoFrames(mainWindow: BrowserWindow, script: string) {
  await mainWindow.webContents.executeJavaScript(script, true).catch(() => {})

  const frames = mainWindow.webContents.mainFrame.framesInSubtree

  await Promise.allSettled(
    frames.map((frame: WebFrameMain) => frame.executeJavaScript(script, true))
  )
}

function normalizePathname(pathname: string) {
  if (!pathname) return '/'

  const trimmed = pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname
  return trimmed || '/'
}

function normalizeHash(hash: string) {
  if (!hash || hash === '#' || hash === '#/') return ''
  return hash
}

function isStartPageUrl(url: string) {
  try {
    const current = new URL(url)
    const start = new URL(START_URL)

    return (
      current.origin === start.origin &&
      normalizePathname(current.pathname) === normalizePathname(start.pathname) &&
      normalizeHash(current.hash) === normalizeHash(start.hash)
    )
  } catch {
    return url === START_URL
  }
}

export function registerNavigation(
  mainWindow: BrowserWindow,
  idle: { iniciarTempoInativo: () => void }
) {
  async function addNavigationButtons() {
    const url = mainWindow.webContents.getURL()
    const isCustomPdfViewer = url.includes('#lpx-pdf-viewer')
    const isStartPage = isStartPageUrl(url)

    if (isStartPage || isCustomPdfViewer) {
      await mainWindow.webContents.insertCSS(`
        .navigation-buttons { display: none !important; }
        .lpx-download-hint { display: none !important; }
        .lpx-admin-warning { display: none !important; }
        body::-webkit-scrollbar { display: none; }
        body::before { content: none !important; display: none !important; height: 0 !important; }
      `)

      await injectScriptIntoFrames(mainWindow, NAVIGATION_SCRIPT)

      if (isStartPage) {
        await mainWindow.webContents.executeJavaScript(START_PAGE_SCRIPT).catch(() => {})
      }

      return
    }

    await mainWindow.webContents.insertCSS(`
      body::before { content:'' !important; display:block !important; height:60px !important; overflow-x:hidden; }
      body::-webkit-scrollbar { display: none; }

      html.lpx-sine-hash-route body::before {
        content: none !important;
        display: none !important;
        height: 0 !important;
      }

      html.lpx-sine-hash-route #root > div:first-child {
        box-sizing: border-box !important;
        padding-top: 60px !important;
      }

      .navigation-buttons {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 60px;
        display: flex !important;
        justify-content: space-between;
        align-items: center;
        background-color: transparent;
        padding: 10px;
        z-index: 9999;
        border: none;
        pointer-events: none;
      }

      .navigation-buttons button {
        pointer-events: auto;
        margin-right: 10px;
        margin-left: 10px;
      }

      .lpx-download-hint {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10000;
        display: none;
        max-width: min(720px, calc(100vw - 32px));
        padding: 12px 18px;
        border-radius: 999px;
        background: rgba(8, 47, 73, 0.94);
        color: #fff;
        font-size: 18px;
        font-weight: 700;
        text-align: center;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
        pointer-events: none;
      }

      .lpx-admin-warning {
        display: none !important;
      }
    `)

    await injectScriptIntoFrames(mainWindow, NAVIGATION_SCRIPT)
    idle.iniciarTempoInativo()
  }

  mainWindow.webContents.on('did-finish-load', () => {
    void addNavigationButtons()
  })
  mainWindow.webContents.on('did-navigate', () => {
    void addNavigationButtons()
  })
  mainWindow.webContents.on('did-navigate-in-page', () => {
    void addNavigationButtons()
  })

  void addNavigationButtons()
}
