import { useEffect, useMemo, useRef, useState } from 'react'
import type { Application } from 'pixi.js'
import qrcode from 'qrcode-generator'
import audio from '../audio/AudioManager'
import VolumeControl from './VolumeControl'
import { TvXp } from './XpPanel'
import {
  FIELD_BLOCK_SIZE,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  setFieldCols,
  ZOOM_LEVEL,
} from '../engine/constants'
import type { StatisticsView } from '../engine/StatisticsAnimation'
import { createApp, createSceneSync, type RenderableScene } from '../lan/LanBattle'
import { loadCustomSprites } from '../render/customSprites'
import Renderer from '../render/Renderer'
import { sharedAtlas } from '../render/SpriteAtlas'
import BattleOverlay, { type BattleView } from '../ui/BattleOverlay'
import { INITIAL_VIEW } from '../ui/battleView'
import { push, replace } from '../ui/router'
import StatisticsScene from '../ui/StatisticsScene'
import {
  connectParty,
  deviceId,
  disconnectParty,
  partyKey,
  partyMirror,
  rememberPartyKey,
  sendParty,
  usePartyStore,
} from './client'
import { attachKeyboard, watchGamepads } from './controls'
import { LocalPad, type LocalPadState } from './localPad'
import { WIDE_STAGE, type PartyRoomState } from './protocol'
import { hasRecordStart, recordStage } from './profileView'
import { ProfileLogo } from './PlayerProfile'
import { PromotionToast, RankCircle } from './RankBadge'
import './ranks.css'
import { SLOT_COLORS, useBodyClass } from './shared'
import { rankProgress } from './ranks'
import './party.css'
import './tvLobby.css'

const FRAME_H = SCREEN_HEIGHT * ZOOM_LEVEL

/**
 * Ekran telewizora: w lobby kod QR dla telefonów, w grze sam obraz.
 * Pad PS / Xbox podłączony do tego urządzenia też gra (bez telefonu); w trybie PC (#/pc) dodatkowo
 * klawiatura.
 */
export default function TvScreen({
  code,
  mute,
  accessKey,
  pc = false,
}: {
  code: string | null
  mute: boolean
  accessKey: string | null
  /** #/pc: gra na samym komputerze — klawiatura i pady jako gracze */
  pc?: boolean
}) {
  const joinedCode = usePartyStore((s) => s.code)
  const room = usePartyStore((s) => s.room)
  const game = usePartyStore((s) => s.game)
  const [keyboardOn, setKeyboardOn] = useKeyboardSetting(pc)
  const localPlayers = useLocalPlayers(joinedCode, keyboardOn)
  useBodyClass('party')

  useEffect(() => {
    rememberPartyKey(accessKey)
    connectParty('tv', code)
    return disconnectParty
    // kod z adresu bierzemy tylko przy wejściu; potem rządzi serwer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    audio.setMuted(mute)
    return () => audio.setMuted(false)
  }, [mute])

  // dźwięk zawsze włączony: przeglądarka odblokowuje go dopiero po geście użytkownika, więc
  // próbujemy co sekundę — wystarczy dowolne kliknięcie / klawisz (także w oknie nad ramką gry
  // w #/dev i #/test, które ma pozwolenie „autoplay”), żeby dźwięk ruszył sam, bez szukania przycisku
  useEffect(() => {
    const id = window.setInterval(() => {
      // tworzy kontekst, jeśli go nie ma, i wznawia wstrzymany; gdy już gra — nic nie robi
      void audio.unlock().catch(() => {})
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  // zakładka w TV pamięta pokój, więc po odświeżeniu telefony nie muszą skanować od nowa
  useEffect(() => {
    // klucz zostaje w pamięci przeglądarki, z paska adresu znika
    if (joinedCode != null && (joinedCode !== code || accessKey != null)) {
      replace(`/${pc ? 'pc' : 'tv'}/${joinedCode}${mute ? '?mute' : ''}`)
    }
  }, [joinedCode, code, mute, accessKey, pc])

  if (room?.playing && game > 0 && partyMirror() != null) {
    const cols = room.fieldCols ?? FIELD_BLOCK_SIZE
    return (
      <>
        <TvBattle
          key={`${game}-${cols}`}
          cols={cols}
          paused={room.paused}
          mute={mute}
          xp={room.xp?.config.enabled === true}
        />
        <TvXp room={room} />
        {room.paused && <TvPauseMenu />}
        <PromotionToast />
      </>
    )
  }
  return (
    <>
      <TvLobby
        room={room}
        localPlayers={localPlayers}
        keyboardOn={keyboardOn}
        onKeyboard={setKeyboardOn}
        mute={mute}
      />
      <PromotionToast />
    </>
  )
}

const KEYBOARD_STORAGE = 'party-keyboard'

/** przeglądarka telewizora — strzałki pilota nie powinny dołączać „klawiatury” jako gracza */
function looksLikeTv(): boolean {
  return /smart-?tv|tizen|web0s|webos|bravia|android tv|\baft[a-z]|crkey|hbbtv|netcast|viera/i.test(
    navigator.userAgent,
  )
}

/** telefon (dotyk, mały ekran) — tu zwykle chce się pada, nie ekranu */
function looksLikePhone(): boolean {
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600
}

/**
 * Czy klawiatura tego urządzenia gra (jeden link dla wszystkich: komputer — tak, TV i telefon — nie).
 * Wybór z przełącznika w lobby („tylko TV” / „TV + klawiatura”) zostaje zapamiętany w przeglądarce.
 */
function useKeyboardSetting(pc: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    // zapamiętany wybór wygrywa także w #/pc — komputer może być samym ekranem (gra się telefonami)
    try {
      const saved = localStorage.getItem(KEYBOARD_STORAGE)
      if (saved != null) return saved === '1'
    } catch {
      // prywatne okno — zgadujemy po urządzeniu
    }
    return pc || (!looksLikeTv() && !looksLikePhone())
  })
  const set = (value: boolean) => {
    setOn(value)
    try {
      localStorage.setItem(KEYBOARD_STORAGE, value ? '1' : '0')
    } catch {
      // trudno — tylko do odświeżenia
    }
  }
  return [on, set]
}

function insideTestBench(): boolean {
  try {
    return window.top !== window.self && window.top!.location.hash.startsWith('#/test')
  } catch {
    return false
  }
}

interface LocalPlayer extends LocalPadState {
  key: string
  label: string
  /** zmiana profilu z ekranu (‹ ›) */
  stepProfile: (delta: number) => void
  /** zmiana koloru czołgu z ekranu (▲ ▼) */
  stepColor: (delta: number) => void
}

function padLabel(name: string): string {
  if (/dualsense|dualshock|wireless controller|054c/i.test(name)) return 'Pad PlayStation'
  if (/xbox|xinput|045e/i.test(name)) return 'Pad Xbox'
  return 'Pad'
}

/**
 * Gracze podpięci do tego ekranu: każdy pad dołącza po pierwszym naciśnięciu przycisku,
 * klawiatura (tylko tryb PC) po pierwszym klawiszu sterowania. Dla serwera to zwykłe pady.
 */
function useLocalPlayers(code: string | null, keyboard: boolean): LocalPlayer[] {
  const [players, setPlayers] = useState<Map<string, LocalPlayer>>(new Map())

  useEffect(() => {
    // w ramce strony testowej (#/test) sterowanie należy do pada obok, nie do ekranu
    if (code == null || insideTestBench()) return
    const pads = new Map<string, LocalPad>()
    const patch = (key: string, state: Partial<LocalPlayer>) =>
      setPlayers((m) => {
        const current = m.get(key)
        return current == null ? m : new Map(m).set(key, { ...current, ...state })
      })
    const ensure = (key: string, label: string): LocalPad => {
      let pad = pads.get(key)
      if (pad == null) {
        const created = new LocalPad(deviceId() + '-' + key, code, (state) => patch(key, state))
        pad = created
        setPlayers((m) =>
          new Map(m).set(key, {
            key,
            label,
            slot: null,
            error: null,
            stepProfile: (delta) => created.stepProfile(delta),
            stepColor: (delta) => created.stepColor(delta),
          }),
        )
        pads.set(key, pad)
      }
      return pad
    }
    const remove = (key: string) => {
      pads.get(key)?.close()
      pads.delete(key)
      setPlayers((m) => {
        const next = new Map(m)
        next.delete(key)
        return next
      })
    }

    const detachKeys = keyboard
      ? attachKeyboard(
          window,
          (input) => {
            // klawiatura dołącza dopiero, gdy ktoś nią steruje
            if (input.direction != null || input.fire) ensure('kb', 'Klawiatura').setInput(input)
            else pads.get('kb')?.setInput(input)
          },
          (command) => ensure('kb', 'Klawiatura').command(command),
        )
      : () => {}
    const stopPads = watchGamepads({
      onConnect: (index, name) => ensure('pad' + index, padLabel(name)),
      onDisconnect: (index) => remove('pad' + index),
      onInput: (index, input) => pads.get('pad' + index)?.setInput(input),
      onCommand: (index, command) => pads.get('pad' + index)?.command(command),
    })
    return () => {
      detachKeys()
      stopPads()
      for (const pad of pads.values()) pad.close()
      setPlayers(new Map())
    }
  }, [code, keyboard])

  return [...players.values()]
}

function useFitScale(width: number, height: number, bottom = 0): number {
  const compute = () =>
    Math.min(window.innerWidth / width, Math.max(1, window.innerHeight - bottom) / height)
  const [scale, setScale] = useState(compute)
  useEffect(() => {
    const onResize = () => setScale(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })
  return scale
}

/** pauza na TV: graj dalej albo koniec gry (powrót do lobby) — myszką lub klawiszami */
function TvPauseMenu() {
  return (
    <div className="tv-pause" role="dialog" aria-label="Pauza">
      <p className="tv-pause-title">PAUZA</p>
      <div className="tv-pause-buttons">
        <button
          type="button"
          className="tv-toggle on"
          onClick={(e) => {
            sendParty({ t: 'pause' })
            e.currentTarget.blur()
          }}
        >
          Graj dalej
        </button>
        <button
          type="button"
          className="tv-toggle"
          onClick={(e) => {
            sendParty({ t: 'quit' })
            e.currentTarget.blur()
          }}
        >
          Koniec gry
        </button>
      </div>
      <p className="tv-pause-keys">
        Graj dalej: Esc / P / Enter / Options · Koniec gry (lobby): Q / L1
      </p>
    </div>
  )
}

type StatisticsPayload = { view: StatisticsView; scores: number[] }

function TvBattle({
  paused,
  cols,
  mute,
  xp,
}: {
  paused: boolean
  cols: number
  mute: boolean
  xp: boolean
}) {
  // szerokość planszy tej gry — zanim powstanie płótno i HUD (lustro ustawi ją też z mapy)
  setFieldCols(cols)
  const FRAME_W = SCREEN_WIDTH * ZOOM_LEVEL
  const containerRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<BattleView>(INITIAL_VIEW)
  const [statistics, setStatistics] = useState<StatisticsPayload | null>(null)
  const scale = useFitScale(FRAME_W, FRAME_H, xp ? 60 : 0)

  useEffect(() => {
    const container = containerRef.current
    const mirror = partyMirror()
    if (container == null || mirror == null) return
    let app: Application | null = null
    let renderer: Renderer | null = null
    let sync: ((scene: RenderableScene | null) => void) | null = null
    let cancelled = false
    let rafId = 0
    let renderedFrames = -1
    let lastView: BattleView | null = null
    let lastStatistics: StatisticsPayload | null = null

    const frame = () => {
      if (sync != null && mirror.frames !== renderedFrames) {
        renderedFrames = mirror.frames
        renderer?.syncDebug(mirror.debug)
        sync(mirror.scene)
      }
      const sounds = mirror.sounds
      mirror.sounds = []
      for (const name of sounds) audio.play(name)
      if (mirror.view != null && mirror.view !== lastView) {
        lastView = mirror.view
        setView(lastView)
      }
      if (mirror.statistics !== lastStatistics) {
        lastStatistics = mirror.statistics
        setStatistics(lastStatistics)
      }
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)

    void (async () => {
      await loadCustomSprites()
      // rozdzielczość rysowania dopasowana do faktycznego rozmiaru na ekranie (maks. ×4)
      const fit = Math.min(window.innerWidth / FRAME_W, window.innerHeight / FRAME_H)
      const resolution = Math.min(4, Math.max(1, Math.ceil(fit * window.devicePixelRatio)))
      const instance = await createApp(resolution)
      if (cancelled) {
        instance.destroy(true)
        return
      }
      app = instance
      container.appendChild(app.canvas)
      renderer = new Renderer(app, sharedAtlas())
      sync = createSceneSync(renderer)
      renderedFrames = -1
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      renderer?.destroy()
      app?.destroy(true)
    }
  }, [])

  return (
    <div className="tv-stage" style={xp ? { bottom: 60 } : undefined}>
      <div
        style={{
          position: 'relative',
          lineHeight: 0,
          width: FRAME_W,
          height: FRAME_H,
          transform: `scale(${scale})`,
        }}
      >
        <div ref={containerRef} />
        {statistics != null && (
          <StatisticsScene view={statistics.view} scores={statistics.scores} />
        )}
        <BattleOverlay
          view={view}
          pauseMenu={null}
          pauseNotice={paused ? 'press start' : null}
          awaitingKey={false}
        />
      </div>
      {paused && <VolumeControl muted={mute} floating />}
    </div>
  )
}

/** telefon nie otworzy „localhost” — wtedy QR prowadzi pod adres tego komputera w Wi-Fi */
function padUrl(code: string, withKey: boolean, lanHost: string | null): string {
  const key = withKey ? partyKey() : null
  const origin = lanHost != null ? `${location.protocol}//${lanHost}` : location.origin
  return `${origin}${location.pathname}#/pad/${code}${key == null ? '' : `?k=${encodeURIComponent(key)}`}`
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** co ile ms sprawdzamy adres komputera w sieci (zmiana Wi-Fi / hotspot) */
const LAN_POLL_MS = 3000

/**
 * dla TV otwartego jako localhost: adres:port komputera w sieci domowej (od lokalnego serwera).
 * Sprawdzany co kilka sekund — po zmianie sieci (inne Wi-Fi, hotspot) QR sam pokazuje nowy adres.
 */
function useLanHost(): string | null {
  const [host, setHost] = useState<string | null>(null)
  useEffect(() => {
    if (!LOCAL_HOSTS.has(location.hostname)) return
    const dir = location.pathname.replace(/[^/]*$/, '')
    let cancelled = false
    const check = () =>
      fetch(`${dir}party/lan`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { adresy?: string[]; port?: number } | null) => {
          if (cancelled) return
          const ip = d?.adresy?.[0]
          setHost(ip != null ? `${ip}:${location.port || d?.port || 80}` : null)
        })
        .catch(() => {})
    void check()
    const id = window.setInterval(() => void check(), LAN_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])
  return host
}

function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  }, [text])
  return <div className="tv-qr" dangerouslySetInnerHTML={{ __html: svg }} />
}

function useAudioLocked(): boolean {
  const [locked, setLocked] = useState(audio.locked)
  useEffect(() => {
    const id = window.setInterval(() => setLocked(audio.locked), 500)
    return () => window.clearInterval(id)
  }, [])
  return locked
}

/** kolory czołgów graczy na ekranie (jak sprite'y w grze) */
const TANK_HEX: Record<string, string> = {
  yellow: '#e7ad3e',
  green: '#96d332',
  blue: '#5aa9ff',
  purple: '#d77bff',
}

/** ułamek wysokości okna w pikselach (np. 7.5 = 7,5vh), przelicza się przy zmianie rozmiaru */
function useVhPx(vh: number): number {
  const compute = () => Math.round((window.innerHeight * vh) / 100)
  const [px, setPx] = useState(compute)
  useEffect(() => {
    const onResize = () => setPx(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })
  return px
}

const ARROW_PATHS = {
  left: 'M15 5 L8 12 L15 19',
  right: 'M9 5 L16 12 L9 19',
  up: 'M5 15 L12 8 L19 15',
  down: 'M5 9 L12 16 L19 9',
} as const

/** okrągły przycisk ze strzałką (‹ › ▲ ▼) */
function Arrow({
  dir,
  label,
  onClick,
}: {
  dir: keyof typeof ARROW_PATHS
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="tt-btn tt-ikona"
      aria-label={label}
      onClick={(e) => {
        onClick()
        e.currentTarget.blur()
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d={ARROW_PATHS[dir]}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

/** puste miejsce o rozmiarze przycisku ze strzałką — wiersze graczy się nie rozjeżdżają */
const ArrowSpace = () => <span className="tt-btn tt-ikona tt-puste" aria-hidden="true" />

function TankGlyph() {
  return (
    <svg className="tt-czolg" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="10.5" y="1.5" width="3" height="9" rx="1" fill="currentColor" />
      <rect x="6" y="7" width="12" height="12" rx="2" fill="currentColor" />
      <rect x="2" y="4" width="4" height="18" rx="1.5" fill="currentColor" opacity=".55" />
      <rect x="18" y="4" width="4" height="18" rx="1.5" fill="currentColor" opacity=".55" />
    </svg>
  )
}

function GuestGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7Z" fill="currentColor" />
    </svg>
  )
}

/** jeden wiersz gracza: kolor ▲▼, awatar, stopień, nazwa, profil ‹ › (klawiatura / pad przy TV) */
function TvPlayerRow({
  room,
  slot,
  local,
  avatar,
}: {
  room: PartyRoomState
  slot: number
  local: LocalPlayer | undefined
  avatar: number
}) {
  const on = room.pads[slot]
  const profileId = room.padPlayers?.[slot]
  const profile = room.players?.find((p) => p.id === profileId)
  const color = room.padColors?.[slot]
  const hex = (color != null ? TANK_HEX[color] : null) ?? SLOT_COLORS[slot]
  const device = local != null ? local.label.toLowerCase() : 'telefon'
  const canStep = local != null && local.slot != null
  return (
    <div className={`tt-gracz${on ? '' : ' tt-wolny'}`} style={{ ['--kolor' as string]: hex }}>
      <div className="tt-kolor">
        {canStep ? (
          <Arrow dir="up" label="Poprzedni kolor" onClick={() => local.stepColor(-1)} />
        ) : (
          <ArrowSpace />
        )}
        <TankGlyph />
        {canStep ? (
          <Arrow dir="down" label="Następny kolor" onClick={() => local.stepColor(1)} />
        ) : (
          <ArrowSpace />
        )}
      </div>
      {profile != null ? (
        <ProfileLogo id={profile.logo} size={avatar} />
      ) : (
        <span className="tt-kolko tt-pusty" style={{ width: avatar, height: avatar }}>
          <GuestGlyph />
        </span>
      )}
      {profile != null ? (
        <RankCircle xp={profile.xp} size={avatar} />
      ) : (
        <span className="tt-kolko" style={{ width: avatar, height: avatar }} />
      )}
      <div className="tt-opis">
        <span className="tt-nazwa">{profile?.name ?? `Gracz ${slot + 1}`}</span>
        <span className="tt-szczegoly">
          {!on ? (
            'wolne miejsce'
          ) : profile != null ? (
            <>
              <b>{rankProgress(profile.xp).rank.nazwa}</b> · {device}
            </>
          ) : (
            `gość · ${device}`
          )}
        </span>
      </div>
      <div className="tt-zmiana">
        {canStep && (room.players?.length ?? 0) > 0 && (
          <>
            <Arrow dir="left" label="Poprzedni profil" onClick={() => local.stepProfile(-1)} />
            <Arrow dir="right" label="Następny profil" onClick={() => local.stepProfile(1)} />
          </>
        )}
      </div>
    </div>
  )
}

/** wiersz ustawienia: nazwa po lewej, wybór po prawej, opis pod spodem */
function Option({
  name,
  children,
  note,
}: {
  name: string
  children: React.ReactNode
  note?: React.ReactNode
}) {
  return (
    <div className="tt-opcja">
      <span className="tt-opcja-nazwa">{name}</span>
      <div className="tt-wybor">{children}</div>
      {note != null && <small>{note}</small>}
    </div>
  )
}

/** klawisz w stopce */
const Key = ({ k }: { k: string }) => <kbd>{k}</kbd>

function TvLobby({
  room,
  localPlayers,
  keyboardOn,
  onKeyboard,
  mute,
}: {
  room: PartyRoomState | null
  localPlayers: LocalPlayer[]
  keyboardOn: boolean
  onKeyboard: (on: boolean) => void
  mute: boolean
}) {
  const lanHost = useLanHost()
  const connected = usePartyStore((s) => s.connected)
  const error = usePartyStore((s) => s.error)
  const audioLocked = useAudioLocked()
  const avatar = useVhPx(7.5)

  if (room == null) {
    return (
      <div className="tt">
        <div className="tt-strona tt-czekanie">
          <h1 className="tt-tytul">Tanki Tankers</h1>
          <p className="tt-maly">
            {error ?? (connected ? 'Zakładam pokój…' : 'Łączę z serwerem…')}
          </p>
        </div>
      </div>
    )
  }
  // QR z kluczem (telefon dołącza jednym skanem), na ekranie adres bez klucza
  const qrUrl = padUrl(room.code, true, lanHost)
  const url = padUrl(room.code, false, lanHost)
  const result = room.lastResult
  const stage =
    room.stageIndex === WIDE_STAGE
      ? 'Losowe szerokie'
      : room.stageIndex < 0
        ? 'Losowe'
        : `${room.stageIndex + 1} / ${room.stageCount}`
  return (
    <div className="tt">
      <div className="tt-strona">
        {/* ===== nagłówek ===== */}
        <header className="tt-naglowek">
          <div className="tt-logo">
            <span className="tt-etykieta">01_TANKI_TANKERS // LOBBY</span>
            <h1 className="tt-tytul" title={`Wersja ${__APP_VERSION__}`}>
              Tanki Tankers
            </h1>
          </div>
          <div className="tt-pokoj">
            <small>Kod pokoju</small>
            <b>{room.code}</b>
          </div>
        </header>

        {/* ===== treść ===== */}
        <main className="tt-tresc">
          <section className="tt-panel tt-dolacz">
            <h2>Dołącz telefonem</h2>
            <QrCode text={qrUrl} />
            <p className="tt-adres">{url}</p>
          </section>

          <section className="tt-panel tt-gracze">
            <h2>Gracze</h2>
            <div className="tt-lista">
              {room.pads.map((_, slot) => (
                <TvPlayerRow
                  key={slot}
                  room={room}
                  slot={slot}
                  local={localPlayers.find((p) => p.slot === slot)}
                  avatar={avatar}
                />
              ))}
            </div>
            {localPlayers.some((p) => p.slot != null) && (
              <p className="tt-wskazowka">
                Klawiatura i pady: góra / dół zmienia kolor czołgu, lewo / prawo profil. Dwóch
                graczy nie może mieć tego samego koloru.
              </p>
            )}
            {localPlayers
              .filter((p) => p.error != null)
              .map((p) => (
                <p key={p.key} className="tt-uwaga">
                  {p.label}: {p.error}
                </p>
              ))}
            {result != null && (
              <p className="tt-wynik">
                {result.cleared
                  ? 'Wszystkie plansze zaliczone!'
                  : `Koniec gry na planszy ${result.stageName}`}
                {' · '}
                {result.scores.map((sc, i) => `${i + 1}P: ${sc}`).join('   ')}
              </p>
            )}
          </section>

          <section className="tt-panel tt-ustawienia">
            <h2>Ustawienia</h2>
            <Option name="Plansza">
              <Arrow
                dir="left"
                label="Poprzednia plansza"
                onClick={() => sendParty({ t: 'stage', delta: -1 })}
              />
              <span className="tt-wartosc">{stage}</span>
              <Arrow
                dir="right"
                label="Następna plansza"
                onClick={() => sendParty({ t: 'stage', delta: 1 })}
              />
            </Option>
            {(room.difficultyNames?.length ?? 0) > 1 && (
              <Option
                name="Poziom"
                note={
                  room.difficultyChooser != null
                    ? `zmienia też Gracz ${room.difficultyChooser + 1}`
                    : undefined
                }
              >
                <Arrow
                  dir="left"
                  label="Łatwiej"
                  onClick={() => sendParty({ t: 'difficulty', delta: -1 })}
                />
                <span className="tt-wartosc">{room.difficultyNames[room.difficulty]}</span>
                <Arrow
                  dir="right"
                  label="Trudniej"
                  onClick={() => sendParty({ t: 'difficulty', delta: 1 })}
                />
              </Option>
            )}
            {room.profile != null && (
              <Option
                name="Drużyna"
                note={
                  <>
                    rekord: plansza {recordStage(room)}
                    {hasRecordStart(room) && (
                      <button
                        type="button"
                        className={`tt-btn tt-maly-btn${room.profile.fromRecord ? ' on' : ''}`}
                        onClick={(e) => {
                          sendParty({ t: 'from-record', on: !room.profile!.fromRecord })
                          e.currentTarget.blur()
                        }}
                      >
                        {room.profile.fromRecord ? 'Start od rekordu' : 'Start od początku'}
                      </button>
                    )}
                  </>
                }
              >
                <Arrow
                  dir="left"
                  label="Poprzednia drużyna"
                  onClick={() => sendParty({ t: 'profile', delta: -1 })}
                />
                <span className="tt-wartosc">{room.profile.name}</span>
                <Arrow
                  dir="right"
                  label="Następna drużyna"
                  onClick={() => sendParty({ t: 'profile', delta: 1 })}
                />
              </Option>
            )}
            <Option
              name="Sterowanie"
              note={
                <>
                  pady PS / Xbox działają zawsze
                  {looksLikePhone() && (
                    <button
                      type="button"
                      className="tt-btn tt-maly-btn on"
                      onClick={() => push(`/pad/${room.code}`)}
                    >
                      Steruj tym telefonem
                    </button>
                  )}
                </>
              }
            >
              <div className="tt-segment">
                <button
                  type="button"
                  className={`tt-btn${keyboardOn ? '' : ' on'}`}
                  onClick={(e) => {
                    onKeyboard(false)
                    e.currentTarget.blur()
                  }}
                >
                  Tylko TV
                </button>
                <button
                  type="button"
                  className={`tt-btn${keyboardOn ? ' on' : ''}`}
                  onClick={(e) => {
                    onKeyboard(true)
                    // Enter / spacja mają dalej sterować grą, a nie przełączać przycisk
                    e.currentTarget.blur()
                  }}
                >
                  TV + klawiatura
                </button>
              </div>
            </Option>
            <Option name="Głośność">
              <VolumeControl muted={mute} />
            </Option>
          </section>

          <section className="tt-panel tt-xp">
            <TvXp room={room} />
          </section>
        </main>

        {/* ===== stopka: sterowanie ===== */}
        <footer className="tt-stopka">
          <span>
            Dołącz: <Key k="dowolny przycisk" /> / <Key k="strzałka" /> / kod QR
          </span>
          <span>
            Start: <Key k="Options" /> <Key k="Enter" />
          </span>
          <span>
            Plansza: <Key k="L1" /> <Key k="△" /> / <Key k="Q" /> <Key k="E" />
          </span>
          <span>
            Poziom: <Key k="L2" /> <Key k="Share" /> / <Key k="Z" /> <Key k="X" />
          </span>
          <span>
            Kolor: <Key k="↑" /> <Key k="↓" />
          </span>
          <span>
            Profil: <Key k="←" /> <Key k="→" />
          </span>
          <span>
            Pauza: <Key k="Esc" /> <Key k="P" /> · koniec gry w pauzie: <Key k="Q" /> <Key k="L1" />
          </span>
        </footer>
        {audioLocked && (
          <p className="tt-uwaga tt-dzwiek">Naciśnij OK na pilocie, aby włączyć dźwięk</p>
        )}
        {!connected && (
          <p className="tt-uwaga tt-dzwiek">Brak połączenia z serwerem, łączę ponownie…</p>
        )}
      </div>
    </div>
  )
}
