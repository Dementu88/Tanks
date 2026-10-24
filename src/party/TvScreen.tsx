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
import { PlayerBadge, useBodyClass } from './shared'
import './party.css'

const TV_HINT =
  'Zeskanuj kod telefonem albo naciśnij przycisk na padzie podłączonym do TV. ' +
  'START (Options na padzie) zaczyna grę.'
const PC_HINT =
  'Naciśnij przycisk na padzie albo strzałkę na klawiaturze, żeby dołączyć. ' +
  'Options / Enter zaczyna grę, L1 / △ albo Q / E zmieniają planszę, L2 / Share albo Z / X poziom trudności. Telefony też mogą dołączyć.'

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

/** dla TV otwartego jako localhost: adres:port komputera w sieci domowej (od lokalnego serwera) */
function useLanHost(): string | null {
  const [host, setHost] = useState<string | null>(null)
  useEffect(() => {
    if (!LOCAL_HOSTS.has(location.hostname)) return
    const dir = location.pathname.replace(/[^/]*$/, '')
    fetch(`${dir}party/lan`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { adresy?: string[]; port?: number } | null) => {
        const ip = d?.adresy?.[0]
        if (ip != null) setHost(`${ip}:${location.port || d?.port || 80}`)
      })
      .catch(() => {})
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

/** ‹ › przy graczu klawiatury / pada — zmiana profilu myszką */
function ProfileStep({
  right,
  label,
  onClick,
}: {
  right?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="tv-toggle tv-profile-step"
      aria-label={label}
      onClick={(e) => {
        onClick()
        e.currentTarget.blur()
      }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d={right ? 'M9 5 L16 12 L9 19' : 'M15 5 L8 12 L15 19'}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
      </svg>
    </button>
  )
}

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

  if (room == null) {
    return (
      <div className="tv-lobby">
        <h1 className="tv-title">BATTLE CITY · STABLE</h1>
        <p className="tv-muted">{error ?? (connected ? 'Zakładam pokój…' : 'Łączę z serwerem…')}</p>
      </div>
    )
  }
  // QR z kluczem (telefon dołącza jednym skanem), na ekranie adres bez klucza
  const qrUrl = padUrl(room.code, true, lanHost)
  const url = padUrl(room.code, false, lanHost)
  const result = room.lastResult
  return (
    <div className="tv-lobby">
      <h1 className="tv-title" title={`Wersja ${__APP_VERSION__}`}>
        BATTLE CITY · STABLE
      </h1>
      <div className="tv-columns">
        <div className="tv-join">
          <QrCode text={qrUrl} />
          <p className="tv-url">{url}</p>
          <div className="tv-controls">
            <span className="tv-label">Sterowanie tutaj:</span>
            <button
              type="button"
              className={keyboardOn ? 'tv-toggle on' : 'tv-toggle'}
              onClick={(e) => {
                onKeyboard(!keyboardOn)
                // Enter / spacja mają dalej sterować grą, a nie przełączać przycisk
                e.currentTarget.blur()
              }}
            >
              {keyboardOn ? 'Ten ekran: TV + klawiatura' : 'Ten ekran: tylko TV'}
            </button>
            <span className="tv-muted">pady PS / Xbox zawsze</span>
            {looksLikePhone() && (
              <button
                type="button"
                className="tv-toggle on"
                onClick={() => push(`/pad/${room.code}`)}
              >
                Steruj tym telefonem
              </button>
            )}
          </div>
          <VolumeControl muted={mute} />
          <TvXp room={room} />
        </div>
        <div className="tv-info">
          <p className="tv-label">Kod pokoju</p>
          <p className="tv-code">{room.code}</p>
          <div className="tv-pads">
            {room.pads.map((on, slot) => {
              const local = localPlayers.find((p) => p.slot === slot)
              const status = local != null ? local.label : on ? 'gotowy' : 'czeka'
              const profileId = room.padPlayers?.[slot]
              const profile = room.players?.find((p) => p.id === profileId)
              return (
                <div key={slot} className={`tv-pad ${on ? 'on' : ''}`}>
                  <PlayerBadge slot={slot} />
                  {local != null && (room.players?.length ?? 0) > 0 && (
                    <ProfileStep label="Poprzedni profil" onClick={() => local.stepProfile(-1)} />
                  )}
                  {profile != null ? (
                    <span className="tv-pad-profile">
                      <ProfileLogo id={profile.logo} size={26} />
                      <RankCircle xp={profile.xp} size={26} />
                      {profile.name}
                    </span>
                  ) : (
                    local != null && <span className="tv-pad-profile">Gość</span>
                  )}
                  {local != null && (room.players?.length ?? 0) > 0 && (
                    <ProfileStep
                      right
                      label="Następny profil"
                      onClick={() => local.stepProfile(1)}
                    />
                  )}
                  <span>{status}</span>
                </div>
              )
            })}
          </div>
          {localPlayers.some((p) => p.slot != null) && (room.players?.length ?? 0) > 0 && (
            <p className="tv-muted tv-profile-hint">
              Klawiatura i pady: strzałka lewo / prawo zmienia profil gracza
            </p>
          )}
          {localPlayers
            .filter((p) => p.error != null)
            .map((p) => (
              <p key={p.key} className="tv-warn">
                {p.label}: {p.error}
              </p>
            ))}
          <p className="tv-label">
            {room.stageIndex === WIDE_STAGE
              ? 'Plansze losowe szerokie (każda gra inna)'
              : room.stageIndex < 0
                ? 'Plansze losowe (każda gra inna)'
                : `Plansza ${room.stageIndex + 1} / ${room.stageCount}`}
          </p>
          {(room.difficultyNames?.length ?? 0) > 1 && (
            <p className="tv-label">
              Poziom trudności: <b>{room.difficultyNames[room.difficulty]}</b>
              {room.difficultyChooser != null && ` (wybiera Gracz ${room.difficultyChooser + 1})`}
            </p>
          )}
          {room.profile != null && (
            <div className="tv-controls">
              <span className="tv-label">Drużyna:</span>
              <button
                type="button"
                className="tv-toggle"
                aria-label="Poprzednia drużyna"
                onClick={(e) => {
                  sendParty({ t: 'profile', delta: -1 })
                  e.currentTarget.blur()
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth="3" />
                </svg>
              </button>
              <b className="tv-profile">{room.profile.name}</b>
              <button
                type="button"
                className="tv-toggle"
                aria-label="Następna drużyna"
                onClick={(e) => {
                  sendParty({ t: 'profile', delta: 1 })
                  e.currentTarget.blur()
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M9 5 L16 12 L9 19" fill="none" stroke="currentColor" strokeWidth="3" />
                </svg>
              </button>
              <span className="tv-muted">rekord: plansza {recordStage(room)}</span>
              {hasRecordStart(room) && (
                <button
                  type="button"
                  className={room.profile.fromRecord ? 'tv-toggle on' : 'tv-toggle'}
                  onClick={(e) => {
                    sendParty({ t: 'from-record', on: !room.profile!.fromRecord })
                    e.currentTarget.blur()
                  }}
                >
                  {room.profile.fromRecord ? 'Start od rekordu' : 'Start od początku'}
                </button>
              )}
            </div>
          )}
          {result != null && (
            <p className="tv-result">
              {result.cleared
                ? 'Wszystkie plansze zaliczone!'
                : `Koniec gry na planszy ${result.stageName}`}
              <br />
              {result.scores.map((s, i) => `${i + 1}P: ${s}`).join('   ')}
            </p>
          )}
          <p className="tv-hint">{keyboardOn ? PC_HINT : TV_HINT}</p>
          {audioLocked && <p className="tv-warn">Naciśnij OK na pilocie, aby włączyć dźwięk</p>}
          {!connected && <p className="tv-warn">Brak połączenia z serwerem, łączę ponownie…</p>}
        </div>
      </div>
    </div>
  )
}
