// Visual das telas que o proprio Electron desenha (barra do gov.br, impressao, avisos).
// Segue a identidade do site do SINE (FrontSine/src/components/sine-theme.css).
// Sem fontes externas: essas paginas tem CSP fechada, entao usa a fonte do sistema como reserva.

export const SINE_FONT = `"Public Sans", "Segoe UI", system-ui, Arial, sans-serif`

export const SINE_COLORS = {
  azul90: '#0C326F',
  azul: '#1351B4',
  azul10: '#E5EEFB',
  amarelo: '#FFCD07',
  verde: '#168821',
  verde10: '#E3F2E5',
  texto: '#1B1F27',
  texto2: '#555F6D',
  borda: '#D5DCE8',
  fundo: '#F2F5FA',
  erro: '#B42318'
} as const

const c = SINE_COLORS

// botoes grandes para toque: altura minima de 64px, icone + texto, sem degradê
export const SINE_BASE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; font-family: ${SINE_FONT}; color: ${c.texto}; -webkit-font-smoothing: antialiased; }

  .sine-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 64px;
    padding: 0 32px;
    border: 2px solid transparent;
    border-radius: 999px;
    font: inherit;
    font-size: 22px;
    font-weight: 800;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: transform 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
  }
  .sine-btn:active { transform: scale(0.96); }
  .sine-btn[disabled] { opacity: 0.6; cursor: wait; transform: none; }
  .sine-btn svg { width: 28px; height: 28px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }

  .sine-btn--pri { background: ${c.azul}; color: #fff; box-shadow: 0 6px 16px rgba(19, 81, 180, 0.28); }
  .sine-btn--pri:active { background: ${c.azul90}; }
  .sine-btn--ok { background: ${c.verde}; color: #fff; box-shadow: 0 6px 16px rgba(22, 136, 33, 0.28); }
  .sine-btn--sec { background: #fff; color: ${c.azul}; border-color: ${c.borda}; }
  .sine-btn--sec:active { background: ${c.azul10}; }
  .sine-btn--ghost { background: ${c.azul10}; color: ${c.azul90}; }

  .sine-spinner {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 7px solid ${c.azul10};
    border-top-color: ${c.azul};
    animation: sine-spin 0.9s linear infinite;
  }
  @keyframes sine-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .sine-spinner { animation-duration: 2.4s; } .sine-btn { transition: none; } }
`

const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`

export const SINE_ICONS = {
  voltar: svg('<path d="M15 6l-6 6 6 6"/>'),
  inicio: svg('<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>'),
  sair: svg('<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 16l4-4-4-4M19 12H10"/>'),
  imprimir: svg(
    '<path d="M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>'
  ),
  repetir: svg('<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>'),
  alerta: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/>'),
  semRede: svg('<path d="M2 8.5a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0"/><path d="M12 19h.01M3 3l18 18"/>')
} as const
