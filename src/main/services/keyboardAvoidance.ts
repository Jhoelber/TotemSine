import type { BrowserWindow } from 'electron'

const FLAG = '__LPX_KEYBOARD_AVOIDANCE_REGISTERED__' as const
const DIAGNOSTICS_ENABLED = false

const KEYBOARD_SCRIPT = `
  (() => {
    if (window.__LPX_EMBEDDED_KEYBOARD__) return;
    window.__LPX_EMBEDDED_KEYBOARD__ = true;

    var diagnosticsEnabled = ${DIAGNOSTICS_ENABLED ? 'true' : 'false'};
    var activeField = null;
    var shiftEnabled = false;
    var symbolsEnabled = false;
    var keyboardRoot = null;
    var keyboardVisible = false;
    var originalBodyPaddingBottom = '';
    var originalHtmlScrollPaddingBottom = '';
    var originalScrollBehavior = '';
    var layoutStateCaptured = false;
    var keyboardHeight = 286;
    var eventCounter = 0;
    var bridgeRequestId = 0;
    var bridgeResolvers = Object.create(null);
    var lastKeyboardInteractionAt = 0;

    var LETTER_ROWS = [
      ['1','2','3','4','5','6','7','8','9','0'],
      ['q','w','e','r','t','y','u','i','o','p'],
      ['a','s','d','f','g','h','j','k','l'],
      ['shift','z','x','c','v','b','n','m','backspace'],
      ['symbols','space','enter','hide']
    ];

    var SYMBOL_ROWS = [
      ['1','2','3','4','5','6','7','8','9','0'],
      ['!','@','#','$','%','&','*','(',')','_'],
      ['-','+','=','/','\\\\','"',\"'\",':',';'],
      ['shift',',','.','?','[',']','{','}','backspace'],
      ['letters','space','enter','hide']
    ];

    function isEditable(el) {
      if (!(el instanceof HTMLElement)) return false;

      if (el instanceof HTMLInputElement) {
        return (
          !el.readOnly &&
          !el.disabled &&
          ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].indexOf(el.type) >= 0
        );
      }

      if (el instanceof HTMLTextAreaElement) {
        return !el.readOnly && !el.disabled;
      }

      return el.isContentEditable;
    }

    function ensureKeyboard() {
      if (keyboardRoot || !document.body) return;

      keyboardRoot = document.createElement('div');
      keyboardRoot.id = 'lpx-virtual-keyboard';
      keyboardRoot.innerHTML = [
        '<style>',
        '#lpx-virtual-keyboard{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;',
        'background:linear-gradient(180deg,#0f172a 0%,#111827 100%);padding:10px 10px 12px;',
        'box-shadow:0 -10px 30px rgba(0,0,0,.35);font-family:Arial,sans-serif;touch-action:none;',
        'display:none;user-select:none;}',
        '#lpx-virtual-keyboard.lpx-visible{display:block;}',
        '#lpx-virtual-keyboard .lpx-row{display:flex;justify-content:center;gap:8px;margin-top:8px;}',
        '#lpx-virtual-keyboard .lpx-row:first-child{margin-top:0;}',
        '#lpx-virtual-keyboard button{border:0;border-radius:12px;min-width:75px;height:62px;',
        'padding:0 18px;background:#f3f4f6;color:#111827;font-size:26px;font-weight:600;',
        'box-shadow:0 2px 0 rgba(0,0,0,.15);}',
        '#lpx-virtual-keyboard button.lpx-wide{min-width:130px;}',
        '#lpx-virtual-keyboard button.lpx-space{min-width:390px;}',
        '#lpx-virtual-keyboard button.lpx-dark{background:#d1d5db;}',
        '#lpx-virtual-keyboard button.lpx-active{background:#93c5fd;}',
        '@media (max-height: 900px){',
        '#lpx-virtual-keyboard{padding:8px 8px 10px;}',
        '#lpx-virtual-keyboard .lpx-row{gap:6px;margin-top:6px;}',
        '#lpx-virtual-keyboard button{min-width:68px;height:56px;padding:0 16px;font-size:24px;border-radius:10px;}',
        '#lpx-virtual-keyboard button.lpx-wide{min-width:116px;}',
        '#lpx-virtual-keyboard button.lpx-space{min-width:338px;}',
        '}',
        '@media (max-height: 760px){',
        '#lpx-virtual-keyboard{padding:6px 6px 8px;}',
        '#lpx-virtual-keyboard .lpx-row{gap:5px;margin-top:5px;}',
        '#lpx-virtual-keyboard button{min-width:60px;height:47px;padding:0 14px;font-size:21px;border-radius:9px;}',
        '#lpx-virtual-keyboard button.lpx-wide{min-width:98px;}',
        '#lpx-virtual-keyboard button.lpx-space{min-width:274px;}',
        '}',
        '</style>'
      ].join('');

      var content = document.createElement('div');
      content.id = 'lpx-virtual-keyboard-content';
      keyboardRoot.appendChild(content);
      document.body.appendChild(keyboardRoot);

      keyboardRoot.addEventListener('mousedown', function(event) {
        event.preventDefault();
      });

      keyboardRoot.addEventListener('touchstart', function(event) {
        event.preventDefault();
      }, { passive: false });

      renderKeys();
      updateKeyboardHeight();
      updateDiagnostics('keyboard-created', describeTarget(activeField));
    }

    function ensureDiagnostics() {}

    function describeTarget(target) {
      if (!(target instanceof Element)) return '(none)';

      var parts = [target.tagName.toLowerCase()];
      if (target.id) parts.push('#' + target.id);
      if (target.className && typeof target.className === 'string') {
        var className = target.className.trim().split(/\\s+/).slice(0, 2).join('.');
        if (className) parts.push('.' + className);
      }
      if (target instanceof HTMLInputElement && target.type) parts.push('type=' + target.type);

      return parts.join('');
    }

    function updateDiagnostics(label, detail) {
      if (!diagnosticsEnabled) return;

      eventCounter += 1;
      console.log(
        '[keyboard-debug]',
        '#' + eventCounter,
        label,
        'keyboard=' + (keyboardVisible ? 'open' : 'closed'),
        'active=' + describeTarget(activeField),
        detail || ''
      );
    }

    window.addEventListener('message', function(event) {
      var data = event.data;
      if (!data || data.__LPX_KEYBOARD_BRIDGE__ !== true) return;

      if (data.type === 'response' && data.requestId) {
        var resolver = bridgeResolvers[data.requestId];
        if (!resolver) return;
        delete bridgeResolvers[data.requestId];
        resolver(!!data.success);
        return;
      }

      if (window !== window.top) return;

      if (data.type === 'request' && data.requestId) {
        Promise.resolve()
          .then(async function() {
            if (!window.totem) return false;

            if (data.action === 'insertText' && typeof window.totem.insertText === 'function') {
              var insertResult = await window.totem.insertText(String(data.value || ''));
              return !!(insertResult && insertResult.success);
            }

            if (data.action === 'sendKey' && typeof window.totem.sendKey === 'function') {
              var keyResult = await window.totem.sendKey(String(data.value || ''));
              return !!(keyResult && keyResult.success);
            }

            if (data.action === 'typeKey' && typeof window.totem.typeKey === 'function') {
              var typeResult = await window.totem.typeKey(data.value || {});
              return !!(typeResult && typeResult.success);
            }

            return false;
          })
          .then(function(success) {
            try {
              event.source && event.source.postMessage({
                __LPX_KEYBOARD_BRIDGE__: true,
                type: 'response',
                requestId: data.requestId,
                success: !!success
              }, '*');
            } catch {}
          })
          .catch(function(error) {
            updateDiagnostics('bridge-request-fail', String(error));
            try {
              event.source && event.source.postMessage({
                __LPX_KEYBOARD_BRIDGE__: true,
                type: 'response',
                requestId: data.requestId,
                success: false
              }, '*');
            } catch {}
          });
      }
    });

    function requestTopBridge(action, value) {
      if (window === window.top) return Promise.resolve(false);

      return new Promise(function(resolve) {
        bridgeRequestId += 1;
        var requestId = 'req-' + bridgeRequestId;
        bridgeResolvers[requestId] = resolve;

        try {
          window.top.postMessage({
            __LPX_KEYBOARD_BRIDGE__: true,
            type: 'request',
            requestId: requestId,
            action: action,
            value: value
          }, '*');
        } catch (error) {
          delete bridgeResolvers[requestId];
          updateDiagnostics('bridge-post-fail', String(error));
          resolve(false);
          return;
        }

        setTimeout(function() {
          if (!bridgeResolvers[requestId]) return;
          delete bridgeResolvers[requestId];
          resolve(false);
        }, 1500);
      });
    }

    function renderKeys() {
      if (!keyboardRoot) return;

      var content = keyboardRoot.querySelector('#lpx-virtual-keyboard-content');
      if (!content) return;
      content.innerHTML = '';

      var rows = symbolsEnabled ? SYMBOL_ROWS : LETTER_ROWS;

      rows.forEach(function(row) {
        var rowEl = document.createElement('div');
        rowEl.className = 'lpx-row';

        row.forEach(function(key) {
          var button = document.createElement('button');
          var label = getKeyLabel(key);
          button.type = 'button';
          button.tabIndex = -1;
          button.textContent = label;
          button.dataset.key = key;

          if (key === 'space') button.classList.add('lpx-space');
          if (
            key === 'shift' ||
            key === 'backspace' ||
            key === 'enter' ||
            key === 'hide' ||
            key === 'symbols' ||
            key === 'letters'
          ) {
            button.classList.add('lpx-wide', 'lpx-dark');
          }
          if (key === 'shift' && shiftEnabled) {
            button.classList.add('lpx-active');
          }

          function handleKeyboardInteraction(event) {
            event.preventDefault();
            event.stopPropagation();

            var now = Date.now();
            if (now - lastKeyboardInteractionAt < 120) {
              updateDiagnostics('keyboard-interaction-skipped', key);
              return;
            }
            lastKeyboardInteractionAt = now;

            void handleKeyPress(key);
          }

          button.addEventListener('pointerdown', handleKeyboardInteraction);
          button.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
          });

          rowEl.appendChild(button);
        });

        content.appendChild(rowEl);
      });
    }

    function getKeyLabel(key) {
      if (key === 'space') return 'Espaço';
      if (key === 'backspace') return 'Apagar';
      if (key === 'enter') return 'Enter';
      if (key === 'shift') return 'Shift';
      if (key === 'hide') return 'Fechar';
      if (key === 'symbols') return '?123';
      if (key === 'letters') return 'ABC';
      return shiftEnabled ? key.toUpperCase() : key;
    }

    function updateKeyboardHeight() {
      if (!keyboardRoot) return;
      keyboardHeight = Math.max(260, keyboardRoot.offsetHeight || 286);
    }

    function findEditableTarget(target) {
      if (!(target instanceof Element)) return null;
      if (isEditable(target)) return target;

      var closest = target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
      if (closest && isEditable(closest)) return closest;
      return null;
    }

    function showKeyboard() {
      ensureKeyboard();
      ensureDiagnostics();
      if (!keyboardRoot) return;
      keyboardRoot.classList.add('lpx-visible');
      keyboardVisible = true;
      updateKeyboardHeight();
      applyBottomSpace();
      updateDiagnostics('show-keyboard', 'height=' + keyboardHeight);
    }

    function hideKeyboard() {
      if (!keyboardRoot) return;
      keyboardRoot.classList.remove('lpx-visible');
      keyboardVisible = false;
      shiftEnabled = false;
      symbolsEnabled = false;
      renderKeys();
      resetBottomSpace();
      updateDiagnostics('hide-keyboard', '');
    }

    function closeKeyboardAndBlur() {
      if (activeField && typeof activeField.blur === 'function') {
        activeField.blur();
      }
      activeField = null;
      hideKeyboard();
      updateDiagnostics('close-and-blur', '');
    }

    function applyBottomSpace() {
      if (!document.body || !document.documentElement || !keyboardVisible) return;

      if (!layoutStateCaptured) {
        originalBodyPaddingBottom = document.body.style.paddingBottom || '';
        originalHtmlScrollPaddingBottom =
          document.documentElement.style.scrollPaddingBottom || '';
        originalScrollBehavior = document.documentElement.style.scrollBehavior || '';
        layoutStateCaptured = true;
      }

      var bottomSpace = keyboardHeight + 24;
      document.body.style.paddingBottom = bottomSpace + 'px';
      document.documentElement.style.scrollPaddingBottom = bottomSpace + 'px';
      document.documentElement.style.scrollBehavior = 'auto';
    }

    function resetBottomSpace() {
      if (!document.body || !document.documentElement) return;

      document.body.style.paddingBottom = originalBodyPaddingBottom;
      document.documentElement.style.scrollPaddingBottom = originalHtmlScrollPaddingBottom;
      document.documentElement.style.scrollBehavior = originalScrollBehavior;
      if (!originalBodyPaddingBottom) document.body.style.removeProperty('padding-bottom');
      if (!originalHtmlScrollPaddingBottom) {
        document.documentElement.style.removeProperty('scroll-padding-bottom');
      }
      if (!originalScrollBehavior) {
        document.documentElement.style.removeProperty('scroll-behavior');
      }
      layoutStateCaptured = false;
      originalBodyPaddingBottom = '';
      originalHtmlScrollPaddingBottom = '';
      originalScrollBehavior = '';
    }

    function getScrollableParent(el) {
      var parent = el.parentElement;

      while (parent) {
        var style = window.getComputedStyle(parent);
        var overflowY = style.overflowY;
        var canScroll =
          (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
          parent.scrollHeight > parent.clientHeight + 4;

        if (canScroll) return parent;
        parent = parent.parentElement;
      }

      return null;
    }

    function keepFieldVisible() {
      if (!activeField || !document.contains(activeField)) return;
      if (!keyboardVisible) return;

      updateKeyboardHeight();
      applyBottomSpace();

      requestAnimationFrame(function() {
        var rect = activeField.getBoundingClientRect();
        var safeTop = Math.max(56, Math.round(window.innerHeight * 0.08));
        var safeBottom = window.innerHeight - keyboardHeight - 28;
        var delta = 0;

        if (rect.top < safeTop) {
          delta = rect.top - safeTop;
        } else if (rect.bottom > safeBottom) {
          delta = rect.bottom - safeBottom;
        }

        if (Math.abs(delta) < 4) return;

        var scroller = getScrollableParent(activeField);
        if (scroller) {
          scroller.scrollTop += delta;
        } else {
          window.scrollBy(0, delta);
        }
      });
    }

    function activateField(target, source) {
      if (!isEditable(target)) return;

      activeField = target;
      updateDiagnostics(source, describeTarget(target));

      try {
        target.focus({ preventScroll: true });
      } catch {
        try {
          target.focus();
        } catch {}
      }

      showKeyboard();
      keepFieldVisible();
      setTimeout(keepFieldVisible, 80);
      setTimeout(keepFieldVisible, 180);
      setTimeout(keepFieldVisible, 320);
    }

    function dispatchKeyboardEvent(el, type, key) {
      try {
        var event = new KeyboardEvent(type, {
          key: key,
          bubbles: true,
          cancelable: true
        });
        el.dispatchEvent(event);
        return !event.defaultPrevented;
      } catch {
        return true;
      }
    }

    function dispatchBeforeInputEvent(el, inputType, text) {
      try {
        var event = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: inputType
        });
        el.dispatchEvent(event);
        return !event.defaultPrevented;
      } catch {
        return true;
      }
    }

    function dispatchInputEvent(el, inputType, text) {
      try {
        var event = new InputEvent('input', {
          bubbles: true,
          data: text,
          inputType: inputType
        });
        el.dispatchEvent(event);
      } catch {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    function activeElementDescription() {
      return describeTarget(document.activeElement);
    }

    function dispatchTextInput(el, text) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (!dispatchKeyboardEvent(el, 'keydown', text)) return;
        if (!dispatchBeforeInputEvent(el, 'insertText', text)) return;

        var start = el.selectionStart == null ? el.value.length : el.selectionStart;
        var end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
        el.setRangeText(text, start, end, 'end');
        dispatchInputEvent(el, 'insertText', text);
        dispatchKeyboardEvent(el, 'keyup', text);
        return;
      }

      if (el && el.isContentEditable) {
        el.focus();
        try {
          document.execCommand('insertText', false, text);
        } catch {}
      }
    }

    function dispatchBackspace(el) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (!dispatchKeyboardEvent(el, 'keydown', 'Backspace')) return;
        if (!dispatchBeforeInputEvent(el, 'deleteContentBackward', null)) return;

        var start = el.selectionStart == null ? el.value.length : el.selectionStart;
        var end = el.selectionEnd == null ? el.value.length : el.selectionEnd;

        if (start !== end) {
          el.setRangeText('', start, end, 'end');
        } else if (start > 0) {
          el.setRangeText('', start - 1, start, 'end');
        }

        dispatchInputEvent(el, 'deleteContentBackward', null);
        dispatchKeyboardEvent(el, 'keyup', 'Backspace');
        return;
      }

      if (el && el.isContentEditable) {
        el.focus();
        try {
          document.execCommand('delete', false);
        } catch {}
      }
    }

    async function insertViaElectron(text) {
      try {
        updateDiagnostics('before-insert-focus', activeElementDescription());
        if (window.totem && typeof window.totem.typeKey === 'function') {
          var typedResult = await window.totem.typeKey({ keyCode: text, text: text });
          updateDiagnostics('electron-type', text + ' success=' + !!(typedResult && typedResult.success) + ' focus=' + activeElementDescription());
          return !!(typedResult && typedResult.success);
        }
        var bridgeTypedResult = await requestTopBridge('typeKey', { keyCode: text, text: text });
        updateDiagnostics('bridge-type', text + ' success=' + bridgeTypedResult + ' focus=' + activeElementDescription());
        if (bridgeTypedResult) return true;
        if (window.totem && typeof window.totem.insertText === 'function') {
          var result = await window.totem.insertText(text);
          updateDiagnostics('electron-insert', text + ' success=' + !!(result && result.success) + ' focus=' + activeElementDescription());
          return !!(result && result.success);
        }
        var bridgeInsertResult = await requestTopBridge('insertText', text);
        updateDiagnostics('bridge-insert', text + ' success=' + bridgeInsertResult + ' focus=' + activeElementDescription());
        return bridgeInsertResult;
      } catch (error) {
        updateDiagnostics('electron-insert-fail', String(error));
      }

      return false;
    }

    async function sendKeyViaElectron(keyCode) {
      try {
        updateDiagnostics('before-key-focus', keyCode + ' focus=' + activeElementDescription());
        if (window.totem && typeof window.totem.typeKey === 'function') {
          var typedKeyResult = await window.totem.typeKey({
            keyCode: keyCode,
            isBackspace: keyCode === 'Backspace',
            isEnter: keyCode === 'Enter'
          });
          updateDiagnostics('electron-type-key', keyCode + ' success=' + !!(typedKeyResult && typedKeyResult.success) + ' focus=' + activeElementDescription());
          return !!(typedKeyResult && typedKeyResult.success);
        }
        var bridgeTypedKeyResult = await requestTopBridge('typeKey', {
          keyCode: keyCode,
          isBackspace: keyCode === 'Backspace',
          isEnter: keyCode === 'Enter'
        });
        updateDiagnostics('bridge-type-key', keyCode + ' success=' + bridgeTypedKeyResult + ' focus=' + activeElementDescription());
        if (bridgeTypedKeyResult) return true;
        if (window.totem && typeof window.totem.sendKey === 'function') {
          var result = await window.totem.sendKey(keyCode);
          updateDiagnostics('electron-key', keyCode + ' success=' + !!(result && result.success) + ' focus=' + activeElementDescription());
          return !!(result && result.success);
        }
        var bridgeKeyResult = await requestTopBridge('sendKey', keyCode);
        updateDiagnostics('bridge-key', keyCode + ' success=' + bridgeKeyResult + ' focus=' + activeElementDescription());
        return bridgeKeyResult;
      } catch (error) {
        updateDiagnostics('electron-key-fail', keyCode + ' ' + String(error));
      }

      return false;
    }

    async function handleKeyPress(key) {
      if (!activeField || !document.contains(activeField)) return;

      activeField.focus();
      updateDiagnostics('key-press', key);

      if (key === 'hide') {
        activeField.blur();
        hideKeyboard();
        return;
      }

      if (key === 'shift') {
        shiftEnabled = !shiftEnabled;
        renderKeys();
        return;
      }

      if (key === 'symbols') {
        symbolsEnabled = true;
        shiftEnabled = false;
        renderKeys();
        return;
      }

      if (key === 'letters') {
        symbolsEnabled = false;
        shiftEnabled = false;
        renderKeys();
        return;
      }

      if (key === 'backspace') {
        if (await sendKeyViaElectron('Backspace')) {
          keepFieldVisible();
          return;
        }
        dispatchBackspace(activeField);
        keepFieldVisible();
        return;
      }

      if (key === 'enter') {
        if (await sendKeyViaElectron('Enter')) {
          keepFieldVisible();
          return;
        }
        dispatchTextInput(activeField, '\\n');
        keepFieldVisible();
        return;
      }

      if (key === 'space') {
        if (await insertViaElectron(' ')) {
          keepFieldVisible();
          return;
        }
        dispatchTextInput(activeField, ' ');
        keepFieldVisible();
        return;
      }

      var value = shiftEnabled && !symbolsEnabled ? key.toUpperCase() : key;
      if (await insertViaElectron(value)) {
        if (shiftEnabled && !symbolsEnabled) {
          shiftEnabled = false;
          renderKeys();
        }

        keepFieldVisible();
        return;
      }
      dispatchTextInput(activeField, value);

      if (shiftEnabled && !symbolsEnabled) {
        shiftEnabled = false;
        renderKeys();
      }

      keepFieldVisible();
    }

    document.addEventListener('focusin', function(event) {
      var target = event.target;
      if (!isEditable(target)) return;

      activateField(target, 'focusin');
    }, true);

    document.addEventListener('focusout', function() {
      setTimeout(function() {
        var current = document.activeElement;

        if (isEditable(current)) {
          activeField = current;
          updateDiagnostics('focusout-keep', describeTarget(current));
          showKeyboard();
          keepFieldVisible();
          return;
        }

        activeField = null;
        updateDiagnostics('focusout-hide', describeTarget(current));
        hideKeyboard();
      }, 120);
    }, true);

    document.addEventListener('pointerdown', function(event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      var clickedKeyboard = keyboardRoot && keyboardRoot.contains(target);
      var editableTarget = findEditableTarget(target);
      var clickedEditable = !!editableTarget;
      updateDiagnostics('pointerdown', describeTarget(target) + ' keyboard=' + !!clickedKeyboard + ' editable=' + !!clickedEditable);

      if (clickedKeyboard || clickedEditable) return;
      if (!keyboardVisible) return;

      closeKeyboardAndBlur();
    }, true);

    function handlePotentialActivation(eventName, event) {
      var target = findEditableTarget(event.target);
      if (!target) return;
      activateField(target, eventName);
    }

    document.addEventListener('click', function(event) {
      handlePotentialActivation('click-editable', event);
    }, true);

    document.addEventListener('mousedown', function(event) {
      handlePotentialActivation('mousedown-editable', event);
    }, true);

    document.addEventListener('touchend', function(event) {
      handlePotentialActivation('touchend-editable', event);
    }, true);

    document.addEventListener('mouseup', function(event) {
      handlePotentialActivation('mouseup-editable', event);
    }, true);

    document.addEventListener('pointerup', function(event) {
      handlePotentialActivation('pointerup-editable', event);
    }, true);

    window.addEventListener('resize', keepFieldVisible);
    window.addEventListener('scroll', keepFieldVisible, true);
    updateDiagnostics('script-loaded', window.location.href);
  })();
`

async function injectKeyboard(mainWindow: BrowserWindow) {
  try {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

    const frames = mainWindow.webContents.mainFrame.framesInSubtree

    const results = await Promise.allSettled(
      frames.map((frame) => frame.executeJavaScript(KEYBOARD_SCRIPT, true))
    )

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        console.log('[keyboard-inject] frame ok', index)
      } else {
        console.error('[keyboard-inject] frame fail', index, result.reason)
      }
    })
  } catch {
    // nunca deixa virar erro fatal
  }
}

export function registerKeyboardAvoidance(mainWindow: BrowserWindow) {
  const wc = mainWindow.webContents as any
  if (wc[FLAG]) return
  wc[FLAG] = true

  if (DIAGNOSTICS_ENABLED) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (!message.includes('[keyboard-debug]')) return
      console.log('[keyboard-console]', { level, message, line, sourceId })
    })
  }

  const patch = () => {
    void injectKeyboard(mainWindow)
  }

  mainWindow.webContents.on('dom-ready', patch)
  mainWindow.webContents.on('did-finish-load', patch)
  mainWindow.webContents.on('did-navigate', patch)
  mainWindow.webContents.on('did-navigate-in-page', patch)

  patch()
}
