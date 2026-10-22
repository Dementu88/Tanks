import { type RefObject, useEffect, useRef, useState } from 'react'
import { useBodyClass } from './shared'
import './party.css'

/** pad w rozmiarze telefonu w poziomie (iPhone 12–15) — tak samo liczy układ jak na telefonie */
const PAD_W = 844
const PAD_H = 390

const KEYS: [string, string][] = [
  ['Strzałki / WASD', 'jazda'],
  ['+ Shift', 'tylko obrót'],
  ['Spacja / J', 'ogień'],
  ['Enter', 'start'],
  ['P / Esc', 'pauza'],
  ['Q / E', 'plansza (LOS, SZER = szeroka)'],
  ['Z / X', 'poziom trudności'],
]

/**
 * #/test — szybkie testy na PC: telewizor i jeden pad obok siebie, pad sterowany klawiaturą
 * (klawisze trafiają do pada niezależnie od tego, które okno ma fokus).
 */
export default function TestBench() {
  const tvRef = useRef<HTMLIFrameElement>(null)
  const padRef = useRef<HTMLIFrameElement>(null)
  const [code, setCode] = useState<string | null>(null)
  const playing = useTvPlaying(tvRef)
  /** null = automatycznie (w grze schowane), true / false = wybór użytkownika */
  const [manual, setManual] = useState<boolean | null>(null)
  useEffect(() => setManual(null), [playing])
  const collapsed = manual ?? playing
  useBodyClass('party')
  useBodyClass('party-test')

  const base = `${location.pathname}${location.search}`

  // pad dołącza dopiero, gdy TV założyło pokój (kod pojawia się w adresie ramki TV)
  useEffect(() => {
    let failures = 0
    const id = window.setInterval(() => {
      let hash = ''
      try {
        hash = tvRef.current?.contentWindow?.location.hash ?? ''
        failures = 0
      } catch {
        // ramka pokazuje stronę błędu (serwer jeszcze nie wstał) — po chwili ładujemy ją ponownie
        failures += 1
        if (failures >= 10 && tvRef.current != null) {
          failures = 0
          tvRef.current.src = `${base}#/tv`
        }
        return
      }
      const match = /^#\/tv\/(\d{4})/.exec(hash)
      if (match != null) {
        setCode(match[1])
        window.clearInterval(id)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [])

  // klawisze z całej strony (także z ramki TV) przekazujemy do pada
  useEffect(() => {
    const forward = (e: KeyboardEvent) => {
      const pad = padRef.current?.contentWindow
      if (pad == null) return
      e.preventDefault()
      pad.dispatchEvent(
        new KeyboardEvent(e.type, {
          code: e.code,
          key: e.key,
          shiftKey: e.shiftKey,
          repeat: e.repeat,
        }),
      )
    }
    const targets: Window[] = [window]
    const attach = () => {
      const tv = tvRef.current?.contentWindow
      if (tv != null && !targets.includes(tv)) targets.push(tv)
      for (const t of targets) {
        t.addEventListener('keydown', forward)
        t.addEventListener('keyup', forward)
      }
    }
    attach()
    const tvFrame = tvRef.current
    tvFrame?.addEventListener('load', attach)
    return () => {
      tvFrame?.removeEventListener('load', attach)
      for (const t of targets) {
        t.removeEventListener('keydown', forward)
        t.removeEventListener('keyup', forward)
      }
    }
  }, [])

  const scale = usePadScale()
  return (
    <div className="test-bench">
      <iframe
        ref={tvRef}
        className="test-tv"
        src={`${base}#/tv`}
        allow="autoplay; fullscreen"
        title="TV"
      />
      <div className={collapsed ? 'test-side collapsed' : 'test-side'}>
        <button
          type="button"
          className="test-toggle icon"
          aria-label={collapsed ? 'Pokaż sterowanie' : 'Schowaj sterowanie'}
          title={collapsed ? 'Pokaż sterowanie' : 'Schowaj sterowanie'}
          onClick={() => setManual(!collapsed)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d={collapsed ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19'}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            />
          </svg>
        </button>
        <div className="test-pad-box" style={{ width: PAD_W * scale, height: PAD_H * scale }}>
          {code == null ? (
            <div className="test-wait">Czekam na telewizor…</div>
          ) : (
            <iframe
              ref={padRef}
              className="test-pad"
              src={`${base}#/pad/${code}?gracz=1`}
              title="Pad"
              style={{ width: PAD_W, height: PAD_H, transform: `scale(${scale})` }}
            />
          )}
        </div>
        <table className="test-keys">
          <tbody>
            {KEYS.map(([key, what]) => (
              <tr key={key}>
                <td>{key}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="test-hint">Kliknij raz w telewizor, żeby włączyć dźwięk.</p>
        <a href="#/sterowanie">Poligon sterowania — lokalnie, bez wrogów</a>
      </div>
    </div>
  )
}

/** czy TV (ramka) pokazuje grę — wtedy sterowanie chowa się w wąski pasek */
function useTvPlaying(tvRef: RefObject<HTMLIFrameElement | null>): boolean {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const id = window.setInterval(() => {
      let now = false
      try {
        now = tvRef.current?.contentDocument?.querySelector('.tv-stage') != null
      } catch {
        // ramka jeszcze się ładuje
      }
      setPlaying(now)
    }, 400)
    return () => window.clearInterval(id)
  }, [])
  return playing
}

/** pad mieści się w prawej kolumnie (ok. 38% szerokości okna) */
function usePadScale(): number {
  const compute = () => Math.min(1, (window.innerWidth * 0.38 - 24) / PAD_W)
  const [scale, setScale] = useState(compute)
  useEffect(() => {
    const onResize = () => setScale(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return scale
}
