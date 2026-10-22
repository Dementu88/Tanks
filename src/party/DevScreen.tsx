import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { MAX_RANK, STAT_LIMITS, type PlayerLevelStats } from '../engine/tankStats'
import type { PowerUpName, TankColor, TankLevel } from '../engine/types'
import { assetUrl, framePaths, loadManifest } from '../render/customSprites'
import { drawTank } from '../render/sprites/tank'
import { socketUrl } from './client'
import type { DevAction, DevPlayerState, DevState, PartyServerMessage } from './protocol'
import { useBodyClass } from './shared'
import './party.css'

/**
 * #/dev — narzędzia na PC. Lewy panel: sterowanie grą i graczami (start, restart, pauza,
 * plansza, tempo, wrogowie, poziom czołgu, bonusy). Środek: gra (klawiatura / pad).
 * Prawy panel: statystyki i skala grafiki LV1–LV5 z zapisem do config/czolgi.json, podgląd animacji.
 * Działa tylko z serwerem lokalnym (bez PARTY_KEY) albo PARTY_DEV=1.
 */
export default function DevScreen() {
  useBodyClass('party')
  useBodyClass('party-dev')
  const gameRef = useRef<HTMLIFrameElement>(null)
  const dev = useDevSocket()
  const [tab, setTab] = useState<'konfiguracja' | 'animacje' | 'wzorce'>('konfiguracja')
  /** poziom wybrany do edycji — ten sam, który ostatnio kliknięto przy graczu */
  const [level, setLevel] = useState(1)
  const base = `${location.pathname}${location.search}`

  useForwardKeys(gameRef)

  return (
    <div className="dev">
      <aside className="dev-panel dev-left">
        <header className="dev-head">
          <b>STEROWANIE</b>
          <span className={dev.connected ? 'dev-ok' : 'dev-bad'}>
            {dev.connected ? 'połączono' : 'brak połączenia'}
          </span>
        </header>
        <ControlPanel dev={dev} onLevel={setLevel} />
      </aside>
      <iframe
        ref={gameRef}
        className="dev-game"
        src={`${base}#/pc`}
        allow="autoplay; fullscreen; gamepad"
        title="Gra"
      />
      <aside className="dev-panel">
        <nav className="dev-tabs">
          <button
            className={tab === 'konfiguracja' ? 'on' : ''}
            onClick={() => setTab('konfiguracja')}
          >
            Konfiguracja LV
          </button>
          <button className={tab === 'animacje' ? 'on' : ''} onClick={() => setTab('animacje')}>
            Animacje
          </button>
          <button className={tab === 'wzorce' ? 'on' : ''} onClick={() => setTab('wzorce')}>
            Wzorce
          </button>
        </nav>
        {tab === 'konfiguracja' ? (
          <ConfigPanel dev={dev} level={level} onLevel={setLevel} />
        ) : tab === 'animacje' ? (
          <AnimationsPanel />
        ) : (
          <ReferencePanel />
        )}
        {dev.message != null && (
          <p className={`dev-msg ${dev.message.ok ? 'dev-ok' : 'dev-bad'}`}>{dev.message.text}</p>
        )}
      </aside>
    </div>
  )
}

// ---------- połączenie z serwerem ----------

interface DevConnection {
  connected: boolean
  stats: PlayerLevelStats[] | null
  state: DevState | null
  message: { ok: boolean; text: string } | null
  send: (action: DevAction) => void
}

function useDevSocket(): DevConnection {
  const [connected, setConnected] = useState(false)
  const [stats, setStats] = useState<PlayerLevelStats[] | null>(null)
  const [state, setState] = useState<DevState | null>(null)
  const [message, setMessage] = useState<DevConnection['message']>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let retry = 0
    const open = () => {
      const ws = new WebSocket(socketUrl())
      wsRef.current = ws
      ws.onopen = () => {
        setConnected(true)
        ws.send(JSON.stringify({ t: 'dev', action: { a: 'stats' } }))
      }
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as PartyServerMessage
        if (msg.t === 'dev-stats') setStats(msg.stats)
        else if (msg.t === 'dev-state') setState(msg.state)
        else if (msg.t === 'dev-result') setMessage({ ok: msg.ok, text: msg.message })
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = window.setTimeout(open, 1000)
      }
    }
    open()
    return () => {
      closed = true
      window.clearTimeout(retry)
      wsRef.current?.close()
    }
  }, [])

  const send = (action: DevAction) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'dev', action }))
  }
  return { connected, stats, state, message, send }
}

/** klawisze z paneli trafiają do gry (inaczej trzeba by klikać w ramkę przed każdym testem) */
function useForwardKeys(ref: RefObject<HTMLIFrameElement | null>) {
  useEffect(() => {
    const forward = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      // w polach paneli (suwaki, liczby) klawisze zostają w panelu
      if (target?.closest('input, select, textarea') != null) return
      const game = ref.current?.contentWindow
      if (game == null) return
      e.preventDefault()
      game.dispatchEvent(
        new KeyboardEvent(e.type, {
          code: e.code,
          key: e.key,
          shiftKey: e.shiftKey,
          repeat: e.repeat,
        }),
      )
    }
    window.addEventListener('keydown', forward)
    window.addEventListener('keyup', forward)
    return () => {
      window.removeEventListener('keydown', forward)
      window.removeEventListener('keyup', forward)
    }
  }, [ref])
}

function Btn({
  children,
  onClick,
  on,
  primary,
  title,
}: {
  children: ReactNode
  onClick: () => void
  on?: boolean
  primary?: boolean
  title?: string
}) {
  const cls = ['dev-btn', on && 'on', primary && 'primary'].filter(Boolean).join(' ')
  return (
    <button className={cls} onClick={onClick} title={title}>
      {children}
    </button>
  )
}

// ---------- lewy panel: gra i gracze ----------

const SPEEDS = [0.25, 0.5, 1, 2]
const POWERUPS: { name: PowerUpName; label: string }[] = [
  { name: 'star', label: 'Gwiazdka' },
  { name: 'helmet', label: 'Hełm' },
  { name: 'shovel', label: 'Łopata' },
  { name: 'grenade', label: 'Granat' },
  { name: 'timer', label: 'Zegar' },
  { name: 'tank', label: '+Czołg' },
]

function ControlPanel({ dev, onLevel }: { dev: DevConnection; onLevel: (l: number) => void }) {
  const s = dev.state
  const send = dev.send
  if (s == null) return <p className="dev-note">Czekam na grę… (otwiera się w środkowym oknie)</p>
  return (
    <div className="dev-section-list">
      <section className="dev-section">
        <h3>
          Gra{' '}
          <small>
            {s.playing ? (s.paused ? 'pauza' : 'trwa') : 'lobby'} · plansza {s.stageName}/
            {s.stageCount}
          </small>
        </h3>
        <div className="dev-grid">
          <Btn primary onClick={() => send({ a: 'start' })}>
            Start
          </Btn>
          <Btn onClick={() => send({ a: 'restart' })}>Restart</Btn>
          <Btn on={s.paused} onClick={() => send({ a: 'pause' })}>
            {s.paused ? 'Wznów' : 'Pauza'}
          </Btn>
          <Btn onClick={() => send({ a: 'stop' })}>Stop</Btn>
        </div>
        <div className="dev-row">
          <Btn onClick={() => send({ a: 'stage', delta: -1 })}>Poprzednia</Btn>
          <span className="dev-value">
            {s.stageIndex === -2
              ? 'Losowa szeroka'
              : s.stageIndex < 0
                ? 'Losowa'
                : `Plansza ${s.stageIndex + 1}`}
          </span>
          <Btn onClick={() => send({ a: 'stage', delta: 1 })}>Następna</Btn>
        </div>
        <div className="dev-row">
          <Btn onClick={() => send({ a: 'difficulty', delta: -1 })}>Łatwiej</Btn>
          <span className="dev-value">{s.difficultyName}</span>
          <Btn onClick={() => send({ a: 'difficulty', delta: 1 })}>Trudniej</Btn>
        </div>
        <div className="dev-row">
          <span className="dev-label">Tempo</span>
          {SPEEDS.map((v) => (
            <Btn
              key={v}
              on={Math.abs(s.speed - v) < 0.01}
              onClick={() => send({ a: 'speed', value: v })}
            >
              {v}×
            </Btn>
          ))}
        </div>
      </section>

      <section className="dev-section">
        <h3>Podgląd AI</h3>
        <Btn on={s.debug} onClick={() => send({ a: 'debug', on: !s.debug })}>
          {s.debug ? 'Ukryj zaawansowane' : 'Pokaż zaawansowane'}
        </Btn>
        {s.debug && (
          <ul className="dev-legend">
            <li>
              <i style={{ background: '#ff9a1f' }} /> wróg wędruje
            </li>
            <li>
              <i style={{ background: '#d04bff' }} /> wróg jedzie na orła
            </li>
            <li>
              <i style={{ background: '#3fa9ff' }} /> autopilot gracza
            </li>
            <li>
              <i style={{ background: '#ff2a2a' }} /> kreska: celuje w gracza z boku
            </li>
            <li>linia = trasa, kropki = punkty, kółko = cel; grubsza i bledsza = przez cegły</li>
          </ul>
        )}
      </section>

      <section className="dev-section">
        <h3>Wrogowie</h3>
        <div className="dev-grid">
          <Btn onClick={() => send({ a: 'kill-bots' })}>Zniszcz wszystkich</Btn>
          <Btn on={s.frozen} onClick={() => send({ a: 'freeze-bots', on: !s.frozen })}>
            Zamrożeni
          </Btn>
          <Btn on={s.botsOff} onClick={() => send({ a: 'bots', on: s.botsOff })}>
            Bez nowych wrogów
          </Btn>
        </div>
      </section>

      {s.players.map((p) => (
        <PlayerCard key={p.slot} player={p} send={send} onLevel={onLevel} />
      ))}
    </div>
  )
}

function PlayerCard({
  player: p,
  send,
  onLevel,
}: {
  player: DevPlayerState
  send: (action: DevAction) => void
  onLevel: (l: number) => void
}) {
  const status = !p.connected
    ? 'nie dołączył'
    : !p.inGame
      ? 'czeka na start'
      : p.alive
        ? `LV${p.rank} · życia ${p.lives}`
        : `zniszczony · życia ${p.lives}`
  const active = p.inGame && p.alive
  return (
    <section className={`dev-section ${active ? '' : 'dev-dim'}`}>
      <h3>
        Gracz {p.slot + 1} <small>{status}</small>
      </h3>
      <div className="dev-row">
        <span className="dev-label">Poziom</span>
        {Array.from({ length: MAX_RANK }, (_, i) => i + 1).map((r) => (
          <Btn
            key={r}
            on={p.rank === r}
            onClick={() => {
              send({ a: 'rank', slot: p.slot, rank: r })
              onLevel(r)
            }}
          >
            LV{r}
          </Btn>
        ))}
      </div>
      <div className="dev-grid">
        <Btn onClick={() => send({ a: 'life', slot: p.slot })}>+1 życie</Btn>
        <Btn on={p.invincible} onClick={() => send({ a: 'god', slot: p.slot, on: !p.invincible })}>
          Nieśmiertelny
        </Btn>
        <Btn onClick={() => send({ a: 'kill-player', slot: p.slot })}>Zniszcz czołg</Btn>
      </div>
      <div className="dev-grid dev-grid-3">
        {POWERUPS.map((pu) => (
          <Btn key={pu.name} onClick={() => send({ a: 'powerup', slot: p.slot, name: pu.name })}>
            {pu.label}
          </Btn>
        ))}
      </div>
    </section>
  )
}

// ---------- prawy panel: konfiguracja LV ----------

const STAT_FIELDS: { key: keyof PlayerLevelStats; label: string; step: number; unit: string }[] = [
  { key: 'spriteScale', label: 'Skala grafiki', step: 0.01, unit: '×' },
  { key: 'moveSpeed', label: 'Prędkość jazdy', step: 0.001, unit: 'px/ms' },
  { key: 'bulletSpeed', label: 'Prędkość pocisku', step: 0.005, unit: 'px/ms' },
  { key: 'fireInterval', label: 'Odstęp strzałów', step: 10, unit: 'ms' },
  { key: 'bulletLimit', label: 'Pociski naraz', step: 1, unit: '' },
  { key: 'bulletPower', label: 'Siła pocisku (3 = stal)', step: 1, unit: '' },
]

function ConfigPanel({
  dev,
  level,
  onLevel,
}: {
  dev: DevConnection
  level: number
  onLevel: (l: number) => void
}) {
  const [draft, setDraft] = useState<PlayerLevelStats[] | null>(null)
  const pending = useRef(0)

  useEffect(() => {
    if (dev.stats != null) setDraft(dev.stats)
  }, [dev.stats])

  const changeStat = (key: keyof PlayerLevelStats, value: number) => {
    if (draft == null) return
    const next = draft.map((row, i) => (i === level - 1 ? { ...row, [key]: value } : row))
    setDraft(next)
    // zmiany lecą do gry na bieżąco (z małym opóźnieniem, żeby suwak nie zalewał serwera)
    window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => dev.send({ a: 'set-stats', stats: next }), 120)
  }

  const row = draft?.[level - 1]
  return (
    <div className="dev-section-list">
      <section className="dev-section">
        <h3>Poziom do edycji</h3>
        <div className="dev-row">
          {Array.from({ length: MAX_RANK }, (_, i) => i + 1).map((l) => (
            <Btn key={l} on={level === l} onClick={() => onLevel(l)}>
              LV{l}
            </Btn>
          ))}
        </div>
        <TankPreview level={level} scale={row?.spriteScale ?? 1} />
        {row == null ? (
          <p className="dev-note">Czekam na serwer…</p>
        ) : (
          STAT_FIELDS.map((f) => (
            <label key={f.key} className="dev-slider">
              <span>
                {f.label}{' '}
                <b>
                  {row[f.key]} {f.unit}
                </b>
              </span>
              <input
                type="range"
                min={STAT_LIMITS[f.key].min}
                max={STAT_LIMITS[f.key].max}
                step={f.step}
                value={row[f.key]}
                onChange={(e) => changeStat(f.key, Number(e.target.value))}
              />
            </label>
          ))
        )}
        <div className="dev-row">
          <Btn primary onClick={() => dev.send({ a: 'save-stats' })}>
            Zapisz do pliku
          </Btn>
          <Btn onClick={() => dev.send({ a: 'load-stats' })}>Cofnij do zapisanych</Btn>
        </div>
        <p className="dev-note">
          Zmiany działają od razu w grze. Zapis: config/czolgi.json — gra bierze go przy starcie i
          budowaniu.
        </p>
      </section>
    </div>
  )
}

/** czołg LV w skali gry (kratka 16 jednostek × 4) z ramką kratki — widać, ile wystaje */
function TankPreview({ level, scale }: { level: number; scale: number }) {
  const CELL = 64
  return (
    <div className="dev-tank-preview">
      <div className="dev-cell" style={{ width: CELL, height: CELL }}>
        <img
          src={assetUrl(`czolgi/gracz/lv${level}/ruch_1.png`)}
          style={{ width: CELL * scale, height: CELL * scale }}
          alt=""
          onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
          onLoad={(e) => (e.currentTarget.style.visibility = 'visible')}
        />
      </div>
      <span className="dev-note">ramka = 1 kratka (hitbox)</span>
    </div>
  )
}

// ---------- podgląd animacji ----------

const DIRECTIONS = [0, 90, 180, 270]

function AnimationsPanel() {
  const [prefixes, setPrefixes] = useState<string[] | null>(null)
  const [scale, setScale] = useState(2)
  const [bg, setBg] = useState<'ciemne' | 'szare' | 'szachownica'>('ciemne')

  useEffect(() => {
    void loadManifest().then((m) => {
      const tanks = Array.from({ length: MAX_RANK }, (_, i) => `czolgi/gracz/lv${i + 1}/ruch`)
      setPrefixes([...new Set([...tanks, ...Object.keys(m)])])
    })
  }, [])

  return (
    <div className="dev-section-list">
      <section className="dev-section">
        <div className="dev-row dev-wrap">
          {[1, 2, 4].map((s) => (
            <Btn key={s} on={scale === s} onClick={() => setScale(s)}>
              ×{s}
            </Btn>
          ))}
          {(['ciemne', 'szare', 'szachownica'] as const).map((b) => (
            <Btn key={b} on={bg === b} onClick={() => setBg(b)}>
              {b}
            </Btn>
          ))}
        </div>
        <p className="dev-note">
          Pliki: public/grafiki/… (specyfikacja w ZADANIE_grafiki_czolgi_dla_ChatGPT.md). Po
          podmianie odśwież stronę.
        </p>
      </section>
      {prefixes?.map((p) => (
        <AnimationRow key={p} prefix={p} scale={scale} bg={bg} />
      ))}
    </div>
  )
}

function AnimationRow({ prefix, scale, bg }: { prefix: string; scale: number; bg: string }) {
  const [paths, setPaths] = useState<string[] | null>(null)
  const [fps, setFps] = useState(12)
  const [playing, setPlaying] = useState(true)
  const [frame, setFrame] = useState(0)
  const images = useMemo(() => {
    return (paths ?? []).map((p) => {
      const img = new Image()
      img.src = assetUrl(p)
      return img
    })
  }, [paths])

  useEffect(() => {
    void framePaths(prefix).then(setPaths)
    void loadManifest().then((m) => setFps(m[prefix]?.fps ?? 12))
  }, [prefix])

  useEffect(() => {
    if (!playing || images.length < 2) return
    const id = window.setInterval(() => setFrame((f) => (f + 1) % images.length), 1000 / fps)
    return () => window.clearInterval(id)
  }, [playing, fps, images.length])

  const current = images[frame % Math.max(1, images.length)]
  return (
    <section className="dev-section">
      <h3>
        {prefix}{' '}
        <small>
          {paths == null ? '…' : paths.length === 0 ? 'brak plików' : `${paths.length} klatek`}
        </small>
      </h3>
      {current != null && (
        <>
          <div className={`dev-anim dev-bg-${bg}`}>
            {DIRECTIONS.map((deg) => (
              <img
                key={deg}
                src={current.src}
                style={{
                  width: current.naturalWidth * scale || undefined,
                  transform: `rotate(${deg}deg)`,
                }}
                alt=""
              />
            ))}
          </div>
          <div className="dev-row dev-wrap">
            <Btn onClick={() => setPlaying(!playing)}>{playing ? 'Pauza' : 'Graj'}</Btn>
            <Btn onClick={() => setFrame((f) => (f + 1) % images.length)}>Następna klatka</Btn>
            <label className="dev-slider dev-inline">
              <span>
                <b>{fps}</b> fps
              </span>
              <input
                type="range"
                min={1}
                max={30}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              />
            </label>
            <span className="dev-note">
              klatka {(frame % Math.max(1, images.length)) + 1}/{images.length}
            </span>
          </div>
        </>
      )}
    </section>
  )
}

// ---------- wzorce: oryginalne czołgi jako PNG (podstawa dla grafik od czata) ----------

const REFERENCE_LEVELS: TankLevel[] = ['basic', 'fast', 'power', 'armor']
const REFERENCE_COLORS: TankColor[] = ['yellow', 'silver']

/** oryginalny czołg 16×16 powiększony bez wygładzania (×4 = format plików gry, 64×64) */
export function referenceDataUrl(level: TankLevel, color: TankColor, shape: 0 | 1, scale = 4) {
  const small = document.createElement('canvas')
  small.width = 16
  small.height = 16
  drawTank(small.getContext('2d')!, 'player', level, color, shape)
  const big = document.createElement('canvas')
  big.width = 16 * scale
  big.height = 16 * scale
  const ctx = big.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, big.width, big.height)
  return big.toDataURL('image/png')
}

function ReferencePanel() {
  return (
    <div className="dev-section-list">
      <section className="dev-section">
        <p className="dev-note">
          Oryginalne czołgi gracza (4 typy × 2 klatki gąsienic), powiększone ×4 do formatu gry
          64×64. Kliknij, żeby pobrać — to wzór sylwetki dla nowych grafik.
        </p>
      </section>
      {REFERENCE_COLORS.map((color) => (
        <section key={color} className="dev-section">
          <h3>{color === 'yellow' ? 'Kolor gracza' : 'Szary'}</h3>
          <div className="dev-ref-grid">
            {REFERENCE_LEVELS.map((level, i) =>
              ([0, 1] as const).map((shape) => {
                const url = referenceDataUrl(level, color, shape)
                const name = `oryginal_lv${i + 1}_${level}_${color}_klatka${shape + 1}.png`
                return (
                  <a key={`${level}${shape}`} href={url} download={name} title={name}>
                    <img src={url} alt={name} />
                    <span>
                      LV{i + 1} · {shape + 1}
                    </span>
                  </a>
                )
              }),
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
