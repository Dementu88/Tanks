import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import qrcode from 'qrcode-generator'
import type { Application } from 'pixi.js'
import { STEP_MS } from '../engine/Game'
import { GAMEPLAY } from '../engine/gameplayConfig'
import { DEFAULT_XP_CONFIG } from '../engine/sessionXp'
import { bulletInterval, bulletLimit, moveSpeed } from '../engine/values'
import { createApp, createSceneSync } from '../lan/LanBattle'
import Renderer from '../render/Renderer'
import { sharedAtlas } from '../render/SpriteAtlas'
import { loadCustomSprites } from '../render/customSprites'
import { ControlLabSimulation } from './ControlLabSimulation'
import { FireButton, enterLandscapeFullscreen, usePadLayout } from './PadScreen'
import TouchJoystick, { type StickSample } from './TouchJoystick'
import { IDLE_INPUT, sameInput, type PadInput } from './controls'
import {
  IDLE_STICK,
  ORIGINAL_STICK,
  STABLE_STICK,
  type StickSettings,
  type StickState,
} from './stick'
import { useBodyClass } from './shared'
import './controlLab.css'
import {
  PROFILE_STORAGE,
  readSavedLabProfile,
  parseLabProfile,
  type LabProfile,
} from './labProfile'
import { useLabHost } from './useLabHost'

const LIMIT = 2000
const NAMES = { up: 'góra', down: 'dół', left: 'lewo', right: 'prawo' }
const mode = (input: StickState) =>
  input.direction == null ? 'STOP' : input.turnOnly ? 'OBRÓT' : 'JAZDA'
const SLIDERS: {
  key: Exclude<keyof StickSettings, 'floating'>
  label: string
  min: number
  max: number
  step: number
  unit: string
}[] = [
  { key: 'deadZone', label: 'Martwa strefa', min: 0.02, max: 0.24, step: 0.01, unit: '%' },
  { key: 'turnZone', label: 'Próg rozpoczęcia jazdy', min: 0.25, max: 0.75, step: 0.01, unit: '%' },
  {
    key: 'directionMargin',
    label: 'Stabilizacja kierunku',
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: '%',
  },
  { key: 'modeMargin', label: 'Margines zatrzymania', min: 0, max: 0.15, step: 0.01, unit: '%' },
  { key: 'sensitivity', label: 'Czułość wychylenia', min: 0.5, max: 2.5, step: 0.05, unit: '×' },
  { key: 'vibration', label: 'Wibracja', min: 0, max: 30, step: 1, unit: 'ms' },
]

interface LogEntry {
  ms: number
  kind: string
  message: string
  data?: unknown
}

export default function ControlLab() {
  useBodyClass('party')
  useBodyClass('control-lab-body')
  const container = useRef<HTMLDivElement>(null)
  const simulation = useRef<ControlLabSimulation | null>(null)
  const held = useRef<PadInput>(IDLE_INPUT)
  const touch = useRef<PadInput>(IDLE_INPUT)
  const keyboard = useRef<PadInput>(IDLE_INPUT)
  const remote = useRef<PadInput>(IDLE_INPUT)
  const remoteStop = useRef<() => void>(() => {})
  const entries = useRef<LogEntry[]>([])
  const started = useRef(performance.now())
  const inputAt = useRef<number | null>(null)
  const stepLatency = useRef(0)
  const sample = useRef<StickSample | null>(null)
  const lastSample = useRef(0)
  const dropped = useRef(0)
  const clearKeyboard = useRef<() => void>(() => {})
  const [initial] = useState(readSavedLabProfile)
  const [settings, setSettings] = useState(initial.stick)
  const [stick, setStick] = useState(IDLE_STICK)
  const [fire, setFire] = useState(false)
  const [obstacles, setObstacles] = useState(true)
  const [run, setRun] = useState(0)
  const [controlsKey, setControlsKey] = useState(0)
  const [tab, setTab] = useState<'settings' | 'logs'>('settings')
  const [panel, setPanel] = useState(false)
  const [stickSize, setStickSize] = useState(initial.stickSize)
  const [fireSize, setFireSize] = useState(initial.fireSize)
  const [turnSnap, setTurnSnap] = useState(initial.turnSnap)
  const turnSnapRef = useRef(turnSnap)
  turnSnapRef.current = turnSnap
  const [inputFrames, setInputFrames] = useState(initial.inputFrames)
  const inputFramesRef = useRef(inputFrames)
  inputFramesRef.current = inputFrames
  const [preview, setPreview] = useState(initial.preview)
  const previewRef = useRef(preview)
  previewRef.current = preview
  const [horizontal, setHorizontal] = useState(false)
  const layout = usePadLayout()
  const rotated = horizontal && layout.rotated
  const [remoteEnabled, setRemoteEnabled] = useState(false)
  const [address, setAddress] = useState('')
  const [savedProfile, setSavedProfile] = useState(initial)
  const [saveMessage, setSaveMessage] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [snapshot, setSnapshot] = useState({
    x: 96,
    y: 160,
    direction: 'góra',
    distance: 0,
    dx: 0,
    dy: 0,
    latency: 0,
    filtering: false,
    hp: 1,
    maxHp: 1,
    speed: 0,
    interval: 0,
    bulletLimit: 1,
    count: 0,
    dropped: 0,
    rows: [] as LogEntry[],
  })

  const log = (kind: string, message: string, data?: unknown) => {
    if (entries.current.length >= LIMIT) {
      entries.current.shift()
      dropped.current++
    }
    entries.current.push({
      ms: Math.round(performance.now() - started.current),
      kind,
      message,
      data,
    })
  }
  const publish = () => {
    const source =
      keyboard.current.direction != null
        ? keyboard.current
        : remote.current.direction != null
          ? remote.current
          : touch.current
    const next = {
      ...source,
      fire: touch.current.fire || keyboard.current.fire || remote.current.fire,
    }
    if (sameInput(next, held.current)) return
    held.current = next
    inputAt.current = performance.now()
    simulation.current?.setInput(next)
    setStick({ direction: next.direction, turnOnly: next.turnOnly })
    setFire(next.fire)
    log(
      'wejście',
      `${mode(next)} · ${next.direction ? NAMES[next.direction] : '—'} · ogień ${next.fire ? 'ON' : 'OFF'}`,
      next,
    )
  }
  const stop = (reason: string) => {
    clearKeyboard.current()
    touch.current = IDLE_INPUT
    keyboard.current = IDLE_INPUT
    remote.current = IDLE_INPUT
    sample.current = null
    publish()
    simulation.current?.stop()
    remoteStop.current()
    setControlsKey((key) => key + 1)
    log('system', reason)
  }
  const stopRef = useRef(stop)
  stopRef.current = stop
  const publishRef = useRef(publish)
  publishRef.current = publish

  useEffect(() => {
    stopRef.current('Zmiana ustawień — puść i ponownie dotknij pada')
    log('ustawienia', 'Profil sterowania', settings)
  }, [settings])

  useEffect(() => {
    stopRef.current('Zmiana siatki skrętu — STOP')
    simulation.current?.setTurnSnap(turnSnap)
    log('ustawienia', `Siatka skrętu: ${turnSnap / 16} kratki (${turnSnap} px)`, { turnSnap })
  }, [turnSnap])

  useEffect(() => {
    stopRef.current('Zmiana filtra wejścia — STOP')
    simulation.current?.setInputFrames(inputFrames)
    log('ustawienia', `Filtr wejścia: ${inputFrames} klatek`, { inputFrames })
  }, [inputFrames])

  useEffect(() => {
    stopRef.current('Zmiana poziomu / XP — STOP')
    simulation.current?.setPreview(preview)
    log('poziomy', 'Podgląd czołgu i premii XP', preview)
  }, [preview])

  useEffect(() => {
    const directions: Record<string, StickState['direction']> = {
      ArrowUp: 'up',
      KeyW: 'up',
      ArrowDown: 'down',
      KeyS: 'down',
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
    }
    let keys: string[] = []
    clearKeyboard.current = () => {
      keys = []
    }
    const update = () => {
      const direction =
        [...keys]
          .reverse()
          .map((key) => directions[key])
          .find(Boolean) ?? null
      keyboard.current = {
        direction,
        turnOnly: direction != null && (keys.includes('ShiftLeft') || keys.includes('ShiftRight')),
        fire: keys.includes('Space'),
      }
      publishRef.current()
    }
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea, button')) return
      if (!(e.code in directions) && !['Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) return
      e.preventDefault()
      if (!keys.includes(e.code)) keys.push(e.code)
      update()
    }
    const up = (e: KeyboardEvent) => {
      if (keys.includes(e.code)) {
        keys = keys.filter((key) => key !== e.code)
        update()
      }
    }
    const blur = () => {
      keys = []
      stopRef.current('Utrata fokusu — STOP')
    }
    const visibility = () => {
      if (document.hidden) blur()
    }
    const resize = () => {
      keys = []
      stopRef.current('Zmiana rozmiaru ekranu — STOP')
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let app: Application | null = null
    let renderer: Renderer | null = null
    let raf = 0
    setReady(false)
    setError('')
    stopRef.current('Start poligonu — zero wrogów')
    const sim = new ControlLabSimulation(obstacles, (event) => {
      if (event.type === 'shot') log('strzał', 'Silnik wystrzelił pocisk', event)
    })
    simulation.current = sim
    sim.setTurnSnap(turnSnapRef.current)
    sim.setInputFrames(inputFramesRef.current)
    sim.setPreview(previewRef.current)
    const start = async () => {
      await loadCustomSprites()
      if (cancelled) return
      const instance = await createApp(1)
      if (cancelled) {
        instance.destroy(true)
        return
      }
      app = instance
      container.current!.appendChild(instance.canvas)
      renderer = new Renderer(instance, sharedAtlas())
      const sync = createSceneSync(renderer)
      let last = performance.now()
      let accumulator = 0
      let lastUi = 0
      let reaction = ''
      setReady(true)
      const frame = (now: number) => {
        accumulator += document.hidden ? 0 : Math.min(100, now - last)
        last = now
        while (accumulator >= STEP_MS) {
          const tank = sim.tank
          const x = tank.x,
            y = tank.y,
            direction = tank.direction
          sim.step()
          if (inputAt.current != null) {
            stepLatency.current = performance.now() - inputAt.current
            inputAt.current = null
          }
          const next = sim.waitingForInput
            ? 'FILTR'
            : tank.direction !== direction
              ? 'OBRÓT'
              : tank.x !== x || tank.y !== y
                ? 'JAZDA'
                : held.current.direction != null && !held.current.turnOnly
                  ? 'BLOKADA'
                  : 'STOP'
          const signature = `${next}:${tank.direction}`
          if (signature !== reaction) {
            reaction = signature
            log(
              'reakcja',
              `${next} · ${NAMES[tank.direction]} · ${tank.x.toFixed(1)}, ${tank.y.toFixed(1)}`,
              {
                x: tank.x,
                y: tank.y,
                direction: tank.direction,
                action: next,
                input: { ...held.current },
              },
            )
          }
          accumulator -= STEP_MS
        }
        sync(sim.scene)
        if (now - lastUi >= 100) {
          lastUi = now
          setSnapshot({
            x: sim.tank.x,
            y: sim.tank.y,
            direction: NAMES[sim.tank.direction],
            distance: sample.current?.distance ?? 0,
            dx: sample.current?.x ?? 0,
            dy: sample.current?.y ?? 0,
            latency: stepLatency.current,
            filtering: sim.waitingForInput,
            hp: sim.tank.hp,
            maxHp: sim.tank.maxHp,
            speed: moveSpeed(sim.tank) * 1000,
            interval: bulletInterval(sim.tank),
            bulletLimit: bulletLimit(sim.tank),
            count: entries.current.length,
            dropped: dropped.current,
            rows: entries.current.slice(-60).reverse(),
          })
        }
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    }
    void start().catch((e: unknown) => {
      if (!cancelled) setError(`Nie udało się uruchomić poligonu: ${String(e)}`)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      sim.stop()
      simulation.current = null
      renderer?.destroy()
      app?.destroy(true)
    }
  }, [run, obstacles])

  const onSample = (next: StickSample) => {
    sample.current = next
    const now = performance.now()
    if (next.event !== 'pointermove' || now - lastSample.current >= 100) {
      lastSample.current = now
      log('dotyk', `${next.event} · x ${next.x.toFixed(2)} · y ${next.y.toFixed(2)}`, next)
    }
  }
  const profile: LabProfile = {
    version: 1,
    stick: settings,
    stickSize,
    fireSize,
    turnSnap,
    inputFrames,
    preview,
  }
  const remember = (p: LabProfile, message: string) => {
    setSavedProfile(p)
    try {
      localStorage.setItem(PROFILE_STORAGE, JSON.stringify(p))
      setSaveMessage(message)
    } catch {
      setSaveMessage(`${message} Pamięć przeglądarki jest niedostępna.`)
    }
    log('zapis', message, p)
  }
  const host = useLabHost(remoteEnabled, profile, {
    onInput: (input, raw) => {
      if (document.hidden && (input.direction != null || input.fire)) {
        remoteStop.current()
        return
      }
      remote.current = input
      publishRef.current()
      if (raw) onSample(raw)
    },
    onLoaded: (p) => {
      setSettings(p.stick)
      setStickSize(p.stickSize)
      setFireSize(p.fireSize)
      setTurnSnap(p.turnSnap)
      setInputFrames(p.inputFrames)
      setPreview(p.preview)
      remember(p, 'Wczytano zapisany profil z PC')
    },
    onSaved: (p) => remember(p, 'Zapisano w config/sterowanie.json na PC'),
    onStatus: setSaveMessage,
  })
  remoteStop.current = host.stop
  const dirty =
    JSON.stringify(parseLabProfile(profile)) !== JSON.stringify(parseLabProfile(savedProfile))
  const phoneHost =
    address ||
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? host.addresses[0]
      : location.hostname)
  const phoneURL =
    phoneHost && host.token
      ? `${location.protocol}//${phoneHost}${location.port ? ':' + location.port : ''}${location.pathname}#/sterowanie-pad/${host.token}`
      : ''
  const qr = useMemo(() => {
    if (!phoneURL) return ''
    const code = qrcode(0, 'M')
    code.addData(phoneURL)
    code.make()
    return code.createDataURL(4, 4)
  }, [phoneURL])
  const save = () => {
    if (remoteEnabled) {
      if (!host.save()) setSaveMessage('Brak połączenia z PC — zapis nie został wykonany.')
    } else {
      try {
        localStorage.setItem(PROFILE_STORAGE, JSON.stringify(profile))
        remember(profile, 'Zapisano w tej przeglądarce')
      } catch {
        setSaveMessage(
          'Nie udało się zapisać w przeglądarce. Włącz połączenie telefonu, aby zapisać plik na PC.',
        )
      }
    }
  }
  const download = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            exportedAt: new Date().toISOString(),
            environment: { userAgent: navigator.userAgent, width: innerWidth, height: innerHeight },
            settings,
            obstacles,
            stickSize,
            fireSize,
            turnSnap,
            inputFrames,
            preview,
            dropped: dropped.current,
            entries: entries.current,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sterowanie-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <main
      className={`control-lab ${horizontal ? 'lab-horizontal' : ''} ${host.padConnected ? 'lab-remote' : ''}`}
      style={
        {
          '--stick-px': `${stickSize}px`,
          '--fire-px': `${fireSize}px`,
          ...(horizontal
            ? {
                width: layout.width,
                height: layout.height,
                '--lab-height': `${layout.height}px`,
                left: rotated ? layout.height : 0,
                transform: rotated ? 'rotate(90deg)' : undefined,
                transformOrigin: 'top left',
              }
            : {}),
        } as CSSProperties
      }
    >
      <header className="lab-header">
        <div>
          <strong>POLIGON STEROWANIA</strong>
          <small>
            Labirynt · zero wrogów ·{' '}
            {host.padConnected ? 'steruje telefon przez Wi-Fi' : 'silnik lokalny'}
          </small>
        </div>
        {host.padConnected && (
          <button
            className="lab-always-visible"
            onClick={() => {
              stop('Reset labiryntu')
              setRun((n) => n + 1)
            }}
          >
            Reset labiryntu
          </button>
        )}
        <button
          className="lab-always-visible"
          aria-pressed={horizontal}
          onClick={() => {
            stop('Zmiana orientacji')
            setHorizontal(!horizontal)
            if (!horizontal) void enterLandscapeFullscreen()
          }}
        >
          {horizontal ? 'Układ auto' : 'Poziomo'}
        </button>
        <button
          onClick={() => {
            stop('Otwarcie panelu')
            setPanel(!panel)
          }}
        >
          Ustawienia / logi
        </button>
        <a href="#/test">Wyjdź</a>
      </header>
      <section className="lab-play">
        <div className="lab-stick-box" key={`stick-${controlsKey}`}>
          <TouchJoystick
            stick={stick}
            settings={settings}
            rotated={rotated}
            onSample={onSample}
            onChange={(next) => {
              touch.current = { ...touch.current, ...next }
              publish()
            }}
          />
          <small>Przesuń kciuk · blisko: obrót · dalej: jazda</small>
        </div>
        <div className="lab-arena">
          <div className="lab-canvas" ref={container} aria-label="Plansza testowa" />
          {!ready && !error && <p>Uruchamianie poligonu…</p>}
          {error && <p role="alert">{error}</p>}
          <div className="lab-live" aria-label="Stan sterowania">
            <b>
              {snapshot.filtering ? 'FILTR — oczekiwanie' : mode(stick)}{' '}
              {stick.direction && `· ${NAMES[stick.direction]}`}
            </b>
            <span>
              Czołg: {snapshot.x.toFixed(1)}, {snapshot.y.toFixed(1)} · {snapshot.direction}
            </span>
            <span>
              Wychylenie: {Math.round(snapshot.distance * 100)}% · wejście → krok:{' '}
              {snapshot.latency.toFixed(1)} ms
            </span>
            <span>
              LV{preview.rank} · HP {snapshot.hp}/{snapshot.maxHp} · {snapshot.speed.toFixed(1)}{' '}
              px/s · strzał co {Math.round(snapshot.interval)} ms · pociski: {snapshot.bulletLimit}
            </span>
          </div>
        </div>
        <div className="lab-fire-box" key={`fire-${controlsKey}`}>
          <FireButton
            pressed={fire}
            vibration={settings.vibration}
            onChange={(value) => {
              touch.current = { ...touch.current, fire: value }
              publish()
            }}
          />
          <button
            onClick={() => {
              stop('Reset planszy')
              setRun((n) => n + 1)
            }}
          >
            Reset planszy
          </button>
          <small>
            PC: WASD / strzałki
            <br />
            Shift: obrót · spacja: ogień
          </small>
        </div>
      </section>
      <aside className={`lab-panel ${panel ? 'open' : ''}`}>
        <nav>
          <button aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>
            Ustawienia
          </button>
          <button aria-pressed={tab === 'logs'} onClick={() => setTab('logs')}>
            Logi ({snapshot.count})
          </button>
          <button className="lab-close" aria-label="Zamknij panel" onClick={() => setPanel(false)}>
            ✕
          </button>
        </nav>
        {tab === 'settings' ? (
          <div className="lab-settings">
            <div className="lab-connect">
              <label className="lab-check">
                <input
                  type="checkbox"
                  checked={remoteEnabled}
                  onChange={(e) => {
                    stop('Zmiana trybu połączenia')
                    setRemoteEnabled(e.target.checked)
                  }}
                />
                Telefon jako pad · panel na PC
              </label>
              {remoteEnabled && (
                <>
                  <p role="status">
                    {host.error ||
                      (host.padConnected
                        ? 'Telefon połączony — steruj i zmieniaj suwaki'
                        : host.connected
                          ? 'Zeskanuj QR telefonem w tej samej sieci Wi-Fi'
                          : 'Łączenie…')}
                  </p>
                  {phoneURL && (
                    <>
                      <img className="lab-qr" src={qr} alt="Kod QR pada telefonu" />
                      {host.addresses.length > 1 && (
                        <label>
                          Adres PC
                          <select
                            aria-label="Adres PC"
                            value={phoneHost}
                            onChange={(e) => setAddress(e.target.value)}
                          >
                            {host.addresses.map((ip) => (
                              <option key={ip} value={ip}>
                                {ip}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <a
                        className="lab-phone-link"
                        href={phoneURL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Otwórz pad telefonu
                      </a>
                      <small className="lab-url">{phoneURL}</small>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="lab-save">
              <button disabled={host.saving} onClick={save}>
                {host.saving ? 'Zapisywanie…' : 'Zapisz'}
              </button>
              <button
                onClick={() => {
                  if (remoteEnabled) {
                    if (!host.load()) setSaveMessage('Brak połączenia z PC')
                  } else {
                    const p = readSavedLabProfile()
                    setSettings(p.stick)
                    setStickSize(p.stickSize)
                    setFireSize(p.fireSize)
                    setTurnSnap(p.turnSnap)
                    setInputFrames(p.inputFrames)
                    setPreview(p.preview)
                    setSavedProfile(p)
                    setSaveMessage('Wczytano zapisany profil')
                  }
                }}
              >
                Wczytaj zapisane
              </button>
            </div>
            <p role="status">
              {dirty ? 'Niezapisane zmiany. ' : ''}
              {saveMessage ||
                'Suwaki działają od razu. Najlepszy profil zachowaj przyciskiem Zapisz.'}
            </p>
            <div className="lab-presets">
              <button onClick={() => setSettings({ ...ORIGINAL_STICK })}>Obecny pad</button>
              <button onClick={() => setSettings({ ...STABLE_STICK })}>Stabilniejszy</button>
            </div>
            <details className="lab-preview" open>
              <summary>Poziom czołgu i XP — podgląd</summary>
              {(
                [
                  { key: 'rank', label: 'Poziom czołgu (gwiazdki)', min: 1, max: 5 },
                  {
                    key: 'speed',
                    label: `XP: szybkość (+${DEFAULT_XP_CONFIG.speedPercent}% / LV)`,
                    min: 0,
                    max: GAMEPLAY.xpMaxLevel,
                  },
                  {
                    key: 'fire',
                    label: `XP: szybkostrzelność (+${DEFAULT_XP_CONFIG.firePercent}% / LV)`,
                    min: 0,
                    max: GAMEPLAY.xpMaxLevel,
                  },
                  {
                    key: 'armor',
                    label: `XP: wytrzymałość (+${DEFAULT_XP_CONFIG.armorHp} HP / LV)`,
                    min: 0,
                    max: GAMEPLAY.xpMaxLevel,
                  },
                ] as const
              ).map(({ key, label, min, max }) => (
                <label className="lab-slider" key={key}>
                  <span>
                    {label}
                    <output>
                      LV {preview[key]}/{max}
                    </output>
                  </span>
                  <input
                    type="range"
                    aria-label={label}
                    min={min}
                    max={max}
                    step={1}
                    value={preview[key]}
                    onChange={(e) => setPreview({ ...preview, [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
              <div className="lab-presets">
                <button
                  disabled={snapshot.hp <= 1}
                  onClick={() => simulation.current?.previewHit()}
                >
                  Trafienie −1 HP
                </button>
                <button onClick={() => simulation.current?.repairArmor()}>Napraw pancerz</button>
              </div>
              <p>
                Podgląd działa od razu, bez wydawania XP sesji. Zapisz zachowuje także te suwaki.
                Trafienie testuje kolor pancerza i zostawia minimum 1 HP. Poligon nadal nie ma
                wrogów ani tarczy startowej.
              </p>
              <p>
                Start gry, tarcze, limit XP i premie: <code>config/rozgrywka.json</code>. Domyślnie
                LV{GAMEPLAY.playerStartRank}, tarcza wroga {GAMEPLAY.enemySpawnShieldMs / 1000} s.
                Po edycji przebuduj grę lub wybierz Aktualizuj serwer.
              </p>
            </details>
            <label className="lab-slider" htmlFor="lab-turn-snap">
              <span>
                Czułość (siatka skrętu)
                <output>
                  {turnSnap === 0
                    ? 'wyłączona'
                    : `${(turnSnap / 16).toLocaleString('pl-PL')} ${turnSnap === 16 ? 'kratka' : 'kratki'} · ${turnSnap} px`}
                </output>
              </span>
              <input
                id="lab-turn-snap"
                type="range"
                min="0"
                max="32"
                step="4"
                value={turnSnap}
                onChange={(e) => setTurnSnap(Number(e.target.value))}
              />
            </label>
            <p>
              1 kratka = pełny blok 16 × 16 px i rozmiar czołgu. Standardowy skręt: ½ kratki (8 px).
              Suwak wyrównuje pozycję przy skręcie o 90°; jazda pozostaje płynna. Ściana blokuje
              wyrównanie. Działa tylko w poligonie.
            </p>
            <label className="lab-slider" htmlFor="lab-input-frames">
              <span>
                Filtr wejścia (klatki)
                <output>
                  {inputFrames === 0
                    ? 'wyłączony'
                    : `${inputFrames} · ≈${Math.round(inputFrames * STEP_MS)} ms`}
                </output>
              </span>
              <input
                id="lab-input-frames"
                type="range"
                min="0"
                max="12"
                step="1"
                value={inputFrames}
                onChange={(e) => setInputFrames(Number(e.target.value))}
              />
            </label>
            <p>
              Pomija krótkie zmiany kierunku i trybu obrót/jazda. Nowe wejście czeka N kroków
              silnika (60/s); w tym czasie czołg stoi. Puszczenie pada i strzał działają od razu. 0
              wyłącza filtr. Oba suwaki działają także z klawiaturą i zapisują się przez Zapisz.
            </p>
            {SLIDERS.map((slider) => (
              <label key={slider.key} className="lab-slider" htmlFor={`lab-${slider.key}`}>
                <span>
                  {slider.label}
                  <output>
                    {slider.unit === '%'
                      ? Math.round(settings[slider.key] * 100)
                      : settings[slider.key]}{' '}
                    {slider.unit}
                  </output>
                </span>
                <input
                  id={`lab-${slider.key}`}
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={settings[slider.key]}
                  onChange={(e) =>
                    setSettings({ ...settings, [slider.key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
            <label className="lab-check">
              <input
                type="checkbox"
                checked={settings.floating}
                onChange={(e) => setSettings({ ...settings, floating: e.target.checked })}
              />
              Środek pod pierwszym dotknięciem
            </label>
            <label className="lab-slider" htmlFor="lab-stick-size">
              <span>
                Rozmiar pada<output>{stickSize} px</output>
              </span>
              <input
                id="lab-stick-size"
                type="range"
                min="140"
                max="1000"
                step="10"
                value={stickSize}
                onChange={(e) => {
                  stop('Rozmiar pada')
                  setStickSize(Number(e.target.value))
                }}
              />
            </label>
            <label className="lab-slider" htmlFor="lab-fire-size">
              <span>
                Rozmiar ognia<output>{fireSize} px</output>
              </span>
              <input
                id="lab-fire-size"
                type="range"
                min="70"
                max="180"
                step="10"
                value={fireSize}
                onChange={(e) => {
                  stop('Rozmiar ognia')
                  setFireSize(Number(e.target.value))
                }}
              />
            </label>
            <label className="lab-check">
              <input
                type="checkbox"
                checked={obstacles}
                onChange={(e) => setObstacles(e.target.checked)}
              />
              Labirynt · pełne i połówkowe przeszkody
            </label>
            <p>
              Margines zatrzymania: po ruszeniu cofnij kciuk poniżej{' '}
              {Math.round(
                Math.max(settings.deadZone, settings.turnZone - settings.modeMargin) * 100,
              )}
              %, aby wrócić do obrotu. Rozmiary przycisków są ograniczone dostępnym miejscem.
            </p>
          </div>
        ) : (
          <div className="lab-log-panel">
            <div className="lab-presets">
              <button onClick={download}>Pobierz JSON</button>
              <button
                onClick={() => {
                  entries.current = []
                  dropped.current = 0
                  log('ustawienia', 'Początek nowego logu', profile)
                }}
              >
                Wyczyść
              </button>
            </div>
            <p>
              Dotyk: maks. 10 próbek/s. Zmiany wejścia, reakcje i strzały: bez pomijania. Bufor:{' '}
              {LIMIT} wpisów; usunięte: {snapshot.dropped}. Widok: ostatnie 60.
            </p>
            <div className="lab-log" aria-label="Log sterowania">
              {snapshot.rows.map((entry, i) => (
                <div key={`${entry.ms}-${i}`}>
                  <time>{(entry.ms / 1000).toFixed(2)}s</time>
                  <b>{entry.kind}</b>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </main>
  )
}
