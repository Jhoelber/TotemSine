import { useEffect, useMemo, useState } from 'react'

type KeyboardKey =
  | string
  | 'shift'
  | 'backspace'
  | 'space'
  | 'enter'
  | 'hide'
  | 'symbols'
  | 'letters'

const GRAVE_ACCENT = '`'
const ACUTE_ACCENT = '\u00B4'

const LETTER_ROWS: KeyboardKey[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '\u00E7'],
  ['shift', 'symbols', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace']
]

const SYMBOL_ROWS: KeyboardKey[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['!', '@', '#', '$', '%', '&', '*', '(', ')', '_'],
  ['-', '+', '=', '/', '\\', '"', "'", ':', ';', ACUTE_ACCENT],
  ['shift', ',', '.', '?', '[', ']', '{', '}', '~', '^', GRAVE_ACCENT, 'backspace'],
  ['letters', '<', '>', '(', ')', '%', '&', '*']
]

const ROW_OFFSETS = ['ml-0', 'ml-[20px]', 'ml-[38px]', 'ml-[12px]'] as const

function isAccentKey(key: KeyboardKey): key is '~' | '\u00B4' | '^' | '`' {
  return key === '~' || key === ACUTE_ACCENT || key === '^' || key === GRAVE_ACCENT
}

function composeAccent(accent: '~' | '\u00B4' | '^' | '`', value: string) {
  const composed: Record<string, Record<string, string>> = {
    '~': { a: '\u00E3', A: '\u00C3', o: '\u00F5', O: '\u00D5', n: '\u00F1', N: '\u00D1' },
    '\u00B4': {
      a: '\u00E1',
      A: '\u00C1',
      e: '\u00E9',
      E: '\u00C9',
      i: '\u00ED',
      I: '\u00CD',
      o: '\u00F3',
      O: '\u00D3',
      u: '\u00FA',
      U: '\u00DA',
      y: '\u00FD',
      Y: '\u00DD'
    },
    '^': { a: '\u00E2', A: '\u00C2', e: '\u00EA', E: '\u00CA', i: '\u00EE', I: '\u00CE', o: '\u00F4', O: '\u00D4', u: '\u00FB', U: '\u00DB' },
    '`': { a: '\u00E0', A: '\u00C0', e: '\u00E8', E: '\u00C8', i: '\u00EC', I: '\u00CC', o: '\u00F2', O: '\u00D2', u: '\u00F9', U: '\u00D9' }
  }

  return composed[accent]?.[value] ?? ''
}

function isLetterLike(value: string) {
  return /^[a-z\u00E7]$/i.test(value)
}

function rowForState(symbolsEnabled: boolean) {
  return symbolsEnabled ? SYMBOL_ROWS : LETTER_ROWS
}

function labelForKey(key: KeyboardKey, shiftEnabled: boolean, symbolsEnabled: boolean) {
  if (key === 'symbols') return '?123'
  if (key === 'letters') return 'ABC'
  if (key === 'hide') return 'Cancelar'
  if (key === 'space') return 'Espaco'
  if (key === 'enter') return 'Avancar'
  if (key === 'backspace') return 'Apagar'
  if (key === 'shift') return 'Shift'

  if (!symbolsEnabled && shiftEnabled && typeof key === 'string' && isLetterLike(key)) {
    return key.toUpperCase()
  }

  return key
}

export default function KeyboardPage(): JSX.Element {
  const [shiftEnabled, setShiftEnabled] = useState(false)
  const [symbolsEnabled, setSymbolsEnabled] = useState(false)
  const [pendingAccent, setPendingAccent] = useState('')

  useEffect(() => {
    return window.totem?.onKeyboardReset?.(() => {
      setShiftEnabled(false)
      setSymbolsEnabled(false)
      setPendingAccent('')
    })
  }, [])

  const rows = useMemo(() => rowForState(symbolsEnabled), [symbolsEnabled])
  const compactFooter = symbolsEnabled

  async function sendAction(payload: { kind: string; text?: string }) {
    await window.totem?.keyboardAction?.(payload)
  }

  async function commitText(text: string) {
    await sendAction({ kind: 'text', text })
  }

  async function hideKeyboard() {
    setPendingAccent('')
    await sendAction({ kind: 'hide' })
  }

  async function handleKey(key: KeyboardKey) {
    if (key === 'hide') {
      await hideKeyboard()
      return
    }

    if (key === 'shift') {
      setShiftEnabled((current) => !current)
      return
    }

    if (key === 'symbols') {
      setSymbolsEnabled(true)
      setShiftEnabled(false)
      return
    }

    if (key === 'letters') {
      setSymbolsEnabled(false)
      setShiftEnabled(false)
      return
    }

    if (key === 'backspace') {
      if (pendingAccent) {
        setPendingAccent('')
        return
      }

      await sendAction({ kind: 'backspace' })
      setShiftEnabled(false)
      return
    }

    if (key === 'space') {
      if (pendingAccent) {
        await commitText(pendingAccent)
        setPendingAccent('')
      }

      await commitText(' ')
      setShiftEnabled(false)
      return
    }

    if (key === 'enter') {
      if (pendingAccent) {
        await commitText(pendingAccent)
        setPendingAccent('')
      }

      await sendAction({ kind: 'enter' })
      setShiftEnabled(false)
      return
    }

    let value = key
    if (!symbolsEnabled && shiftEnabled && isLetterLike(value)) {
      value = value.toUpperCase()
    }

    if (pendingAccent) {
      const accent = pendingAccent as '~' | '\u00B4' | '^' | '`'
      setPendingAccent('')

      const combined = composeAccent(accent, value)
      if (combined) {
        await commitText(combined)
        setShiftEnabled(false)
        return
      }

      if (accent === value) {
        await commitText(accent)
        setShiftEnabled(false)
        return
      }

      await commitText(accent)
      await commitText(value)
      setShiftEnabled(false)
      return
    }

    if (isAccentKey(value)) {
      setPendingAccent(value)
      setShiftEnabled(false)
      return
    }

    await commitText(value)
    setShiftEnabled(false)
  }

  return (
    <main
      className="h-screen w-screen overflow-hidden bg-transparent text-white"
      onPointerDown={() => {
        void hideKeyboard()
      }}
    >
      <section
        className="mx-auto mt-[2px] flex h-[calc(100%-2px)] w-full flex-col rounded-t-[30px] bg-[radial-gradient(circle_at_top,rgba(114,197,255,0.14),transparent_28%),linear-gradient(180deg,#17486f_0%,#143f64_52%,#113857_100%)] px-5 pb-1 pt-2"
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="relative mx-auto flex w-full max-w-[1160px] items-center justify-center">
          <div className="h-[6px] w-[62px] rounded-full bg-white/30" />

          <button
            className={`absolute right-0 grid min-w-[106px] place-items-center rounded-[18px] bg-[linear-gradient(180deg,#5f83a3_0%,#517694_100%)] px-5 leading-none text-white shadow-[0_10px_28px_rgba(8,27,45,0.22)] ${compactFooter ? 'h-[44px] text-[15px]' : 'h-[50px] text-[16px]'} font-semibold`}
            onClick={() => {
              void hideKeyboard()
            }}
            type="button"
          >
            <span>Fechar</span>
          </button>
        </div>

        <div className="mt-2 text-center text-[12px] font-semibold tracking-[0.01em] text-white/90">
          {pendingAccent ? `Acento selecionado: ${pendingAccent}` : 'Toque nas teclas para preencher o campo selecionado'}
        </div>

        <div className={`mx-auto flex w-full max-w-[1160px] flex-col justify-start ${compactFooter ? 'mt-2' : 'mt-3'}`}>
          {rows.map((row, rowIndex) => (
            <div
              key={`row-${rowIndex}`}
              className={`flex justify-center ${ROW_OFFSETS[rowIndex] ?? 'ml-0'} ${compactFooter ? 'mt-[5px] gap-[7px]' : 'mt-[6px] gap-[8px]'}`}
            >
              {row.map((key) => {
                const label = labelForKey(key, shiftEnabled, symbolsEnabled)
                const isToggle = key === 'shift' || key === 'symbols' || key === 'letters'
                const isBackspace = key === 'backspace'
                const isActive = (key === 'shift' && shiftEnabled) || (isAccentKey(key) && pendingAccent === key)
                const baseKeyHeight = compactFooter ? 'h-[44px]' : 'h-[50px]'
                const baseMinWidth = compactFooter ? 'min-w-[90px]' : 'min-w-[100px]'

                const className = [
                  `flex ${baseKeyHeight} ${baseMinWidth} items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,#ffffff_0%,#eef4fb_100%)] px-4 text-[17px] font-semibold text-[#11263a] shadow-[0_8px_20px_rgba(8,27,45,0.10)]`,
                  isToggle ? `${compactFooter ? 'min-w-[108px] text-[15px]' : 'min-w-[122px] text-[16px]'} text-[#16324c]` : '',
                  isBackspace ? `${compactFooter ? 'min-w-[112px]' : 'min-w-[126px]'} flex-col gap-0.5 text-[12px] font-medium text-[#16324c]` : '',
                  isActive ? 'bg-[linear-gradient(180deg,#9cecf4_0%,#75dce8_100%)] text-[#07364e]' : ''
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <button
                    key={`${rowIndex}-${key}`}
                    className={className}
                    onClick={() => {
                      void handleKey(key)
                    }}
                    type="button"
                  >
                    {key === 'shift' ? (
                      <span className="flex items-center gap-2">
                        <span className="text-[20px] leading-none">^</span>
                        <span>{label}</span>
                      </span>
                    ) : null}

                    {key === 'backspace' ? (
                      <>
                        <span className="text-[20px] leading-none">{'<'}</span>
                        <span className="leading-none">{label}</span>
                      </>
                    ) : null}

                    {key !== 'shift' && key !== 'backspace' ? label : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div
          className="mx-auto mt-2 flex w-full max-w-[1160px] items-center"
        >
          <button
            className={`flex w-full items-center justify-center rounded-[22px] bg-[linear-gradient(180deg,#ffffff_0%,#eef4fb_100%)] font-semibold text-[#11263a] shadow-[0_10px_24px_rgba(8,27,45,0.10)] ${compactFooter ? 'h-[46px] text-[16px]' : 'h-[52px] text-[17px]'}`}
            onClick={() => {
              void handleKey('space')
            }}
            type="button"
          >
            Espaco
          </button>
        </div>
      </section>
    </main>
  )
}
