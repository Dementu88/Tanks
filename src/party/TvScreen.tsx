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
  usePartyStore,
} from './client'
import { attachKeyboard, watchGamepads } from './controls'
import { LocalPad, type LocalPadState } from './localPad'
import { WIDE_STAGE, type PartyRoomState } from './protocol'
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
      </>
    )
  }
  return (
    <TvLobby
      room={room}
      localPlayers={localPlayers}
      keyboardOn={keyboardOn}
      onKeyboard={setKeyboardOn}
      mute={mute}
    />
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
        setPlayers((m) => new Map(m).set(key, { key, label, slot: null, error: null }))
        pad = new LocalPad(deviceId() + '-' + key, code, (state) => patch(key, state))
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
        </div>
        <div className="tv-info">
          <p className="tv-label">Kod pokoju</p>
          <p className="tv-code">{room.code}</p>
          <div className="tv-pads">
            {room.pads.map((on, slot) => {
              const local = localPlayers.find((p) => p.slot === slot)
              const status = local != null ? local.label : on ? 'gotowy' : 'czeka'
              return (
                <div key={slot} className={`tv-pad ${on ? 'on' : ''}`}>
                  <PlayerBadge slot={slot} />
                  <span>{status}</span>
                </div>
              )
            })}
          </div>
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
          {result != null && (
            <p className="tv-result">
              {result.cleared
                ? 'Wszystkie plansze zaliczone!'
                : `Koniec gry na planszy ${result.stageName}`}
              <br />
              {result.scores.map((s, i) => `${i + 1}P: ${s}`).join('   ')}
            </p>
          )}
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
          <p className="tv-hint">{keyboardOn ? PC_HINT : TV_HINT}</p>
          {audioLocked && <p className="tv-warn">Naciśnij OK na pilocie, aby włączyć dźwięk</p>}
          {!connected && <p className="tv-warn">Brak połączenia z serwerem, łączę ponownie…</p>}
        </div>
      </div>
    </div>
  )
}
