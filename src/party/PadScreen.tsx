import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import Joystick from './TouchJoystick'
import XpPanel from './XpPanel'
import { IDLE_STICK as IDLE, STABLE_STICK, type StickState } from './stick'
import { push, replace } from '../ui/router'
import {
  connectParty,
  disconnectParty,
  rememberPartyKey,
  sendParty,
  setBuzzHandler,
  usePartyStore,
} from './client'
import {
  attachKeyboard,
  encodePadInput,
  IDLE_INPUT,
  watchGamepads,
  type PadCommand,
  type PadInput,
} from './controls'
import { PAD_SLOTS, WIDE_STAGE, type PartyRoomState } from './protocol'
import { useBodyClass } from './shared'
import '@fontsource/orbitron/500.css'
import '@fontsource/orbitron/700.css'
import './party.css'
import { validTurnSnap } from '../engine/physics/turnAlignment'

/** granica obrót/jazda — domyślna; każdy telefon ustawia swoją suwakiem pod padem */
const TURN_ZONE_DEFAULT = STABLE_STICK.turnZone
const TURN_ZONE_MIN = 0.2
const TURN_ZONE_MAX = 0.75
// Stary próg nie może nadpisać sprawdzonego profilu przy pierwszym uruchomieniu stable.
const TURN_ZONE_STORAGE = 'party-turn-zone-stable'
const SENSITIVITY_STORAGE = 'party-turn-snap-stable'

function savedSensitivity(): number {
  try {
    const raw = localStorage.getItem(SENSITIVITY_STORAGE)
    const value = raw == null ? 8 : Number(raw)
    if (validTurnSnap(value)) return value
  } catch {
    /* prywatne okno */
  }
  return 8
}

function savedTurnZone(): number {
  try {
    const v = Number(localStorage.getItem(TURN_ZONE_STORAGE))
    if (v >= TURN_ZONE_MIN && v <= TURN_ZONE_MAX) return v
  } catch {
    // prywatne okno
  }
  return TURN_ZONE_DEFAULT
}
const vibrate = (ms: number) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    // iOS nie ma vibrate
  }
}

const slotKey = (code: string) => `party-slot-${code}`

function savedSlot(code: string): number | undefined {
  try {
    const raw = sessionStorage.getItem(slotKey(code))
    return raw == null ? undefined : Number(raw)
  } catch {
    return undefined
  }
}

/** Telefon jako pad: joystick (obrót / jazda) + ogień, u góry START, plansza i pauza. */
export default function PadScreen({
  code,
  accessKey,
  player = null,
}: {
  code: string
  accessKey: string | null
  /** stały gracz (0 = Gracz 1) — przejmowany od innego telefonu; null = pierwszy wolny */
  player?: number | null
}) {
  const room = usePartyStore((s) => s.room)
  const slot = usePartyStore((s) => s.slot)
  const connected = usePartyStore((s) => s.connected)
  const error = usePartyStore((s) => s.error)
  const full = usePartyStore((s) => s.full)
  const replaced = usePartyStore((s) => s.replaced)
  const [stick, setStick] = useState<StickState>(IDLE)
  const [turnZone, setTurnZone] = useState(savedTurnZone)
  const [turnSnap, setTurnSnap] = useState(savedSensitivity)
  const [fire, setFire] = useState(false)
  const hardware = useHardwarePad(room)
  const [menu, setMenu] = useState(false)
  const menuPaused = useRef(false)
  // klawiatura / pad sprzętowy ma pierwszeństwo, gdy coś na nim wciśnięto
  const activeStick = hardware.stick.direction != null ? hardware.stick : stick
  const activeFire = fire || hardware.fire
  useBodyClass('party')
  useBodyClass('party-pad')

  useEffect(() => {
    rememberPartyKey(accessKey)
    // klucz zostaje w pamięci telefonu; adres bez niego można spokojnie komuś pokazać
    if (accessKey != null) replace(`/pad/${code}`)
    if (player != null) connectParty('pad', code, player, true)
    else connectParty('pad', code, savedSlot(code))
    setBuzzHandler(vibrate)
    return () => {
      setBuzzHandler(null)
      disconnectParty()
    }
  }, [code])

  useEffect(() => {
    if (slot == null) return
    try {
      sessionStorage.setItem(slotKey(code), String(slot))
    } catch {
      // prywatne okno — trudno, po odświeżeniu dostanie pierwszy wolny slot
    }
  }, [code, slot])

  // stan pada leci tylko przy zmianie; po reconnecie serwer zaczyna od „nic nie wciśnięte”
  // (zależność od liczby, nie od obiektu: ruch gałki przerysowuje ekran co klatkę)
  const bits = encodePadInput({ ...activeStick, fire: activeFire })
  useEffect(() => {
    sendParty({ t: 'in', b: bits })
  }, [bits, connected])

  useEffect(() => {
    try {
      localStorage.setItem(TURN_ZONE_STORAGE, String(turnZone))
    } catch {
      // prywatne okno — ustawienie tylko do odświeżenia
    }
  }, [turnZone])

  useEffect(() => {
    try {
      localStorage.setItem(SENSITIVITY_STORAGE, String(turnSnap))
    } catch {
      /* prywatne okno */
    }
    if (connected && slot != null) sendParty({ t: 'sensitivity', turnSnap })
  }, [turnSnap, connected, slot])

  useWakeLock()
  const layout = usePadLayout()

  if (full || replaced) {
    // slot trzyma inny telefon albo „duch” (np. podgląd QR z aparatu) — pozwalamy go przejąć
    return (
      <div className="pad-message">
        <p>{error}</p>
        <p className="pad-hint">KTÓRYM GRACZEM CHCESZ GRAĆ?</p>
        <div className="pad-takeover">
          {Array.from({ length: PAD_SLOTS }, (_, i) => i).map((i) => (
            <HudButton key={i} primary onClick={() => connectParty('pad', code, i, true)}>
              <TankIcon />
              PRZEJMIJ GRACZA {i + 1}
            </HudButton>
          ))}
        </div>
      </div>
    )
  }
  if (error != null && slot == null) {
    return (
      <div className="pad-message">
        <p>{error}</p>
        <HudButton onClick={() => connectParty('pad', code)}>SPRÓBUJ PONOWNIE</HudButton>
      </div>
    )
  }
  if (slot == null || room == null) {
    return <div className="pad-message">{connected ? 'DOŁĄCZAM…' : 'ŁĄCZĘ Z SERWEREM…'}</div>
  }

  const playing = room.playing
  const inGame = playing && room.playerOfSlot[slot] != null
  const host = room.difficultyChooser === slot
  const openMenu = () => {
    // menu w trakcie gry = pauza; zamknięcie wznawia, jeśli to menu zapauzowało
    menuPaused.current = playing && !room.paused
    if (menuPaused.current) sendParty({ t: 'pause' })
    setMenu(true)
  }
  const closeMenu = (resume: boolean) => {
    if (resume && menuPaused.current && room.playing && room.paused) sendParty({ t: 'pause' })
    menuPaused.current = false
    setMenu(false)
  }
  // lewa połowa: kwadrat na całą wysokość ekranu z joystickiem; prawa: panel, suwak, ogień w rogu
  const side = Math.round(Math.min(layout.height, layout.width * 0.58))
  const fireSize = Math.round(
    1.5 * Math.min(layout.height * 0.42, (layout.width - side) * 0.5, MAX_FIRE),
  )
  return (
    <div
      className="pad"
      style={{
        ['--pad-fire' as string]: `${fireSize}px`,
        width: layout.width,
        height: layout.height,
        ...(layout.rotated
          ? { left: layout.height, transform: 'rotate(90deg)', transformOrigin: 'top left' }
          : { left: 0 }),
      }}
    >
      <div className="pad-left" style={{ width: side, height: side }}>
        <Joystick
          stick={activeStick}
          onChange={setStick}
          rotated={layout.rotated}
          settings={{ ...STABLE_STICK, turnZone }}
        />
      </div>
      <div className="pad-right">
        <div className="pad-top" style={{ minHeight: TOP_BAR }}>
          <div className="pad-player">
            <TankIcon />
            GRACZ {slot + 1}
          </div>
          {!connected && <span className="pad-warn">BRAK POŁĄCZENIA</span>}
          <div className="pad-spacer" />
          {playing ? (
            <>
              <HudButton active={room.paused} onClick={() => sendParty({ t: 'pause' })}>
                {room.paused ? <PlayIcon /> : <PauseIcon />}
                {room.paused ? 'WZNÓW' : 'PAUZA'}
              </HudButton>
              {host ? (
                <MenuButton onClick={openMenu} />
              ) : (
                <HudButton
                  dim
                  onClick={() => {
                    if (window.confirm('Zakończyć grę i wrócić do lobby?')) sendParty({ t: 'quit' })
                  }}
                >
                  KONIEC
                </HudButton>
              )}
            </>
          ) : host ? (
            <>
              <div className="pad-stage">
                <b>{stageShort(room)}</b> · {difficultyName(room)}
              </div>
              <MenuButton onClick={openMenu} />
              <HudButton
                primary
                onClick={() => {
                  void enterLandscapeFullscreen()
                  sendParty({ t: 'start' })
                }}
              >
                START
              </HudButton>
            </>
          ) : (
            <>
              <div className="pad-stage" title="Planszę wybiera pierwszy gracz">
                PLANSZA <b>{stageShort(room)}</b>
              </div>
              {difficultyName(room) !== '' && (
                <div className="pad-stage" title="Poziom wybiera pierwszy gracz">
                  POZIOM <b>{difficultyName(room).toUpperCase()}</b>
                </div>
              )}
              <HudButton
                primary
                onClick={() => {
                  void enterLandscapeFullscreen()
                  sendParty({ t: 'start' })
                }}
              >
                START
              </HudButton>
            </>
          )}
          <div className="pad-spacer" />
          <FullscreenButton />
        </div>
        <div className="pad-tuning" onKeyDown={(e) => e.stopPropagation()}>
          <label className="pad-zone">
            <span>STREFA OBROTU</span>
            <input
              type="range"
              min={TURN_ZONE_MIN}
              max={TURN_ZONE_MAX}
              step={0.01}
              value={turnZone}
              onChange={(e) => setTurnZone(Number(e.target.value))}
              aria-label="Wielkość strefy samego obrotu w joysticku"
            />
          </label>
          <label className="pad-zone">
            <span>
              CZUŁOŚĆ{' '}
              <output>
                {turnSnap === 0 ? 'WYŁ.' : `${(turnSnap / 16).toLocaleString('pl-PL')} ×`}
              </output>
            </span>
            <input
              type="range"
              min="0"
              max="32"
              step="4"
              value={turnSnap}
              onChange={(e) => setTurnSnap(Number(e.target.value))}
              aria-label="Czułość — siatka skrętu"
              title="Wyrównanie przy skręcie: 1 × = jedna kratka; 0 = wyłączone"
            />
          </label>
        </div>
        <div className="pad-middle">
          {room.paused && <span className="pad-paused">PAUZA</span>}
          {playing && !inGame && (
            <span className="pad-note">GRA TRWA BEZ CIEBIE — DOŁĄCZYSZ W NASTĘPNEJ</span>
          )}
        </div>
        <div className="pad-fire-area">
          <FireButton pressed={activeFire} onChange={setFire} />
        </div>
      </div>
      {menu && host && <HostMenu room={room} onClose={closeMenu} />}
    </div>
  )
}

const TOP_BAR = 54
/** przycisk ognia: mniejszy niż joystick, w prawym dolnym rogu */
const MAX_FIRE = 190

interface PadLayout {
  /** telefon trzymany pionowo (albo obrócił się sam): rysujemy pad obrócony o 90° */
  rotated: boolean
  /** wymiary pada w układzie poziomym */
  width: number
  height: number
}

function readLayout(): PadLayout {
  const w = window.innerWidth
  const h = window.innerHeight
  return { rotated: h > w, width: Math.max(w, h), height: Math.min(w, h) }
}

/** pad jest zawsze poziomy: gdy ekran jest pionowy, obracamy go zamiast przestawiać układ */
export function usePadLayout(): PadLayout {
  const [layout, setLayout] = useState(readLayout)
  useEffect(() => {
    const onResize = () => setLayout(readLayout())
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])
  return layout
}

/**
 * Pełny ekran + blokada w bieżącym poziomie (Android; iOS tego nie umie, tam zostaje obrót CSS).
 * Blokujemy konkretną stronę poziomu, żeby obraz nie przeskakiwał przy przechyleniu telefonu.
 */
export async function enterLandscapeFullscreen(): Promise<void> {
  try {
    if (document.fullscreenEnabled && document.fullscreenElement == null) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    }
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>
    }
    const current = orientation.type.startsWith('landscape')
      ? orientation.type
      : 'landscape-primary'
    await orientation.lock?.(current)
  } catch {
    // przeglądarka odmówiła — zostaje obrót CSS
  }
}

/** #/pad bez kodu: wpisz kod z telewizora */
export function PadJoin() {
  const [value, setValue] = useState('')
  useBodyClass('party')
  return (
    <form
      className="pad-message"
      onSubmit={(e) => {
        e.preventDefault()
        if (/^\d{4}$/.test(value)) push(`/pad/${value}`)
      }}
    >
      <p>WPISZ KOD POKOJU Z TELEWIZORA</p>
      <input
        className="pad-code-input"
        inputMode="numeric"
        maxLength={4}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        autoFocus
      />
      <HudButton primary type="submit">
        DOŁĄCZ
      </HudButton>
    </form>
  )
}

function HudButton({
  children,
  onClick,
  primary,
  dim,
  icon,
  active,
  label,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  primary?: boolean
  dim?: boolean
  icon?: boolean
  active?: boolean
  label?: string
  type?: 'button' | 'submit'
}) {
  const cls = ['hud-btn', primary && 'primary', dim && 'dim', icon && 'icon', active && 'on']
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={cls} onClick={onClick} aria-label={label}>
      {children}
    </button>
  )
}

// ---------- oprawa HUD wokół okręgów ----------

const polar = (r: number, deg: number): [number, number] => [
  50 + r * Math.sin((deg * Math.PI) / 180),
  50 - r * Math.cos((deg * Math.PI) / 180),
]

function arcPath(r: number, from: number, to: number): string {
  const [x0, y0] = polar(r, from)
  const [x1, y1] = polar(r, to)
  return `M${x0} ${y0} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

const TICKS = Array.from({ length: 72 }, (_, i) => {
  const major = i % 6 === 0
  const [x1, y1] = polar(46.5, i * 5)
  const [x2, y2] = polar(major ? 43.6 : 44.9, i * 5)
  return { x1, y1, x2, y2, major }
})

/** podziałka i łuki, które powoli się kręcą (w różne strony i z różną prędkością) */
function HudFrame() {
  return (
    <g className="hud-deco">
      <circle cx="50" cy="50" r="47" className="hud-ring-thin" />
      <g className="spin-slow">
        {TICKS.map(({ major, ...line }, i) => (
          <line key={i} {...line} className={major ? 'hud-tick major' : 'hud-tick'} />
        ))}
      </g>
      <g className="spin-rev">
        <path d={arcPath(51, 20, 110)} className="hud-arc" />
        <path d={arcPath(51, 200, 262)} className="hud-arc" />
      </g>
      <g className="spin-fast">
        <path d={arcPath(54.5, 140, 158)} className="hud-arc-thin" />
        <path d={arcPath(54.5, 320, 345)} className="hud-arc-thin" />
      </g>
    </g>
  )
}

/** ciemna tarcza pod sterowaniem — poza poświatą, żeby nie rozjaśniała środka */
function HudPlate() {
  return <circle cx="50" cy="50" r="40" className="hud-plate" />
}

export function FireButton({
  pressed,
  onChange,
  vibration = 15,
}: {
  pressed: boolean
  onChange: (v: boolean) => void
  vibration?: number
}) {
  const pointer = useRef<number | null>(null)
  const element = useRef<HTMLDivElement>(null)
  const callback = useRef(onChange)
  callback.current = onChange
  useEffect(() => {
    const reset = () => {
      const id = pointer.current
      pointer.current = null
      if (id != null && element.current?.hasPointerCapture(id))
        element.current.releasePointerCapture(id)
      callback.current(false)
    }
    const hidden = () => {
      if (document.hidden) reset()
    }
    window.addEventListener('blur', reset)
    window.addEventListener('resize', reset)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('blur', reset)
      window.removeEventListener('resize', reset)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])
  const release = (e: ReactPointerEvent) => {
    if (e.pointerId !== pointer.current) return
    pointer.current = null
    onChange(false)
  }
  return (
    <div
      ref={element}
      role="button"
      aria-label="Ogień"
      aria-pressed={pressed}
      className={`pad-ctrl pad-fire ${pressed ? 'active' : ''}`}
      onPointerDown={(e) => {
        if (pointer.current != null || e.button !== 0) return
        e.preventDefault()
        pointer.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        if (vibration > 0) vibrate(vibration)
        onChange(true)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <HudFrame />
        <HudPlate />
        <circle cx="50" cy="50" r="40" className="hud-pulse" />
        <circle cx="50" cy="50" r="26" className="hud-fire-core" />
        <g className="spin-rev">
          <circle cx="50" cy="50" r="18" className="hud-dashed" />
        </g>
        <path d="M50 28v8M50 64v8M28 50h8M64 50h8" className="hud-reticle" />
        <circle cx="50" cy="50" r="3" className="hud-dot" />
      </svg>
      <span className="pad-label">OGIEŃ</span>
    </div>
  )
}

// ---------- ikony ----------

function TankIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="7" y="1" width="2" height="6" fill="currentColor" />
      <rect x="4" y="5" width="8" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.5" y="3.5" width="2" height="11" fill="currentColor" opacity=".6" />
      <rect x="12.5" y="3.5" width="2" height="11" fill="currentColor" opacity=".6" />
    </svg>
  )
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={direction === 'left' ? 'M15 4 7 12l8 8' : 'm9 4 8 8-8 8'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4 L20 12 L6 20 Z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="5" height="16" fill="currentColor" />
      <rect x="14" y="4" width="5" height="16" fill="currentColor" />
    </svg>
  )
}

function FullscreenButton() {
  if (!document.fullscreenEnabled) return null
  const toggle = () => {
    if (document.fullscreenElement != null) void document.exitFullscreen().catch(() => {})
    else void enterLandscapeFullscreen()
  }
  return (
    <HudButton icon label="Pełny ekran" onClick={toggle}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        />
      </svg>
    </HudButton>
  )
}

/**
 * Sprzętowe sterowanie pada: klawiatura (testy na PC) i pad PlayStation / Xbox podłączony do
 * telefonu przez Bluetooth. Działa razem z dotykiem — pierwszeństwo ma to, co jest wciśnięte.
 */
const stageShort = (room: PartyRoomState) =>
  room.stageIndex === WIDE_STAGE
    ? 'SZER'
    : room.stageIndex < 0
      ? 'LOS'
      : String(room.stageIndex + 1).padStart(2, '0')

const difficultyName = (room: PartyRoomState) => room.difficultyNames?.[room.difficulty] ?? ''

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="2.5" fill="currentColor" />
      <rect x="4" y="10.75" width="16" height="2.5" fill="currentColor" />
      <rect x="4" y="16.5" width="16" height="2.5" fill="currentColor" />
    </svg>
  )
}

function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <HudButton label="Menu" onClick={onClick}>
      <MenuIcon />
      MENU
    </HudButton>
  )
}

/** wiersz menu: etykieta, strzałki i bieżąca wartość */
function MenuStepper({
  label,
  value,
  onStep,
  note,
}: {
  label: string
  value: string
  onStep: (delta: number) => void
  note?: string
}) {
  return (
    <div className="pad-menu-row">
      <span className="pad-menu-label">{label}</span>
      <HudButton icon label={`${label}: wstecz`} onClick={() => onStep(-1)}>
        <Chevron direction="left" />
      </HudButton>
      <b className="pad-menu-value">{value}</b>
      <HudButton icon label={`${label}: dalej`} onClick={() => onStep(1)}>
        <Chevron direction="right" />
      </HudButton>
      {note != null && <span className="pad-menu-note">{note}</span>}
    </div>
  )
}

/** menu pierwszego gracza: plansza, poziom, start / wznów, restart, koniec gry */
function HostMenu({ room, onClose }: { room: PartyRoomState; onClose: (resume: boolean) => void }) {
  const playing = room.playing
  const stage =
    room.stageIndex === WIDE_STAGE
      ? 'LOSOWA SZEROKA'
      : room.stageIndex < 0
        ? 'LOSOWA'
        : `${room.stageIndex + 1} / ${room.stageCount}`
  return (
    <div className="pad-menu" onClick={() => onClose(true)}>
      <div className="pad-menu-panel" onClick={(e) => e.stopPropagation()}>
        <div className="pad-menu-title">MENU</div>
        {!playing && (
          <MenuStepper
            label="PLANSZA"
            value={stage}
            onStep={(delta) => sendParty({ t: 'stage', delta })}
          />
        )}
        <MenuStepper
          label="POZIOM"
          value={difficultyName(room).toUpperCase()}
          onStep={(delta) => sendParty({ t: 'difficulty', delta })}
          note={playing ? 'od restartu' : undefined}
        />
        <XpPanel room={room} />
        <div className="pad-menu-actions">
          {playing ? (
            <>
              <HudButton primary onClick={() => onClose(true)}>
                <PlayIcon />
                WZNÓW
              </HudButton>
              <HudButton
                onClick={() => {
                  sendParty({ t: 'restart' })
                  onClose(false)
                }}
              >
                RESTART
              </HudButton>
              <HudButton
                dim
                onClick={() => {
                  if (!window.confirm('Zakończyć grę i wrócić do lobby?')) return
                  sendParty({ t: 'quit' })
                  onClose(false)
                }}
              >
                KONIEC GRY
              </HudButton>
            </>
          ) : (
            <>
              <HudButton
                primary
                onClick={() => {
                  void enterLandscapeFullscreen()
                  sendParty({ t: 'start' })
                  onClose(false)
                }}
              >
                START
              </HudButton>
              <HudButton onClick={() => onClose(false)}>ZAMKNIJ</HudButton>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function useHardwarePad(room: PartyRoomState | null): { stick: StickState; fire: boolean } {
  const [keys, setKeys] = useState<PadInput>(IDLE_INPUT)
  const [pads, setPads] = useState<Map<number, PadInput>>(new Map())
  const roomRef = useRef(room)
  roomRef.current = room

  useEffect(() => {
    const onCommand = (command: PadCommand) => {
      const r = roomRef.current
      if (r == null) return
      if (command === 'start') sendParty(r.playing ? { t: 'pause' } : { t: 'start' })
      else if (command === 'pause' && r.playing) sendParty({ t: 'pause' })
      else if (command === 'stage-prev') sendParty({ t: 'stage', delta: -1 })
      else if (command === 'stage-next') sendParty({ t: 'stage', delta: 1 })
      else if (command === 'difficulty-down') sendParty({ t: 'difficulty', delta: -1 })
      else if (command === 'difficulty-up') sendParty({ t: 'difficulty', delta: 1 })
    }
    const detachKeys = attachKeyboard(window, setKeys, onCommand)
    const stopPads = watchGamepads({
      onInput: (index, input) => setPads((m) => new Map(m).set(index, input)),
      onDisconnect: (index) =>
        setPads((m) => {
          const next = new Map(m)
          next.delete(index)
          return next
        }),
      onCommand: (_index, command) => onCommand(command),
    })
    return () => {
      detachKeys()
      stopPads()
    }
  }, [])

  const sources = [keys, ...pads.values()]
  const moving = sources.find((s) => s.direction != null)
  return {
    stick: moving == null ? IDLE : { direction: moving.direction, turnOnly: moving.turnOnly },
    fire: sources.some((s) => s.fire),
  }
}

/** ekran telefonu nie gaśnie w trakcie gry */
function useWakeLock(): void {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const request = async () => {
      try {
        lock =
          (await (
            navigator as Navigator & {
              wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> }
            }
          ).wakeLock?.request('screen')) ?? null
      } catch {
        lock = null
      }
    }
    void request()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [])
}
