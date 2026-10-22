import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  FIELD_BLOCK_SIZE,
  PLAYER_COLORS,
  playerSpawns,
  WIDE_FIELD_COLS,
} from '../src/engine/constants'
import { STEP_MS } from '../src/engine/Game'
import { alignTurn, validTurnSnap } from '../src/engine/physics/turnAlignment'
import { isPerpendicular } from '../src/engine/physics/geometry'
import { SessionXp } from '../src/engine/sessionXp'
import GameSession, { type PlayerConfig } from '../src/engine/GameSession'
import type { StatisticsView } from '../src/engine/StatisticsAnimation'
import type { GameEvent } from '../src/engine/events'
import {
  playerStatsTable,
  setPlayerStatsTable,
  type PlayerLevelStats,
} from '../src/engine/tankStats'
import type { AudioPort, SoundName } from '../src/engine/types'
import type { PlayerControl } from '../src/input/bindings'
import { SceneEncoder, type FrameMessage } from '../src/lan/frame'
import { decodeInput, HostInput, type InputSample } from '../src/lan/input'
import type { LanResult } from '../src/lan/protocol'
import {
  WIDE_STAGE,
  CLOSE_BAD_KEY,
  CLOSE_REPLACED,
  type DevAction,
  type DevState,
  INPUT_TURN_ONLY,
  isRoomCode,
  PAD_SLOTS,
  PARTY_PATH,
  type PartyClientMessage,
  type PartyRoomState,
  type PartyServerMessage,
} from '../src/party/protocol'
import { DEFAULT_DIFFICULTY, DIFFICULTY_LEVELS } from '../src/engine/difficulty'
import { randomCampaign } from '../src/engine/map/randomStage'
import { stages } from '../src/stages'
import type { BattleView } from '../src/ui/BattleOverlay'
import { toView } from '../src/ui/battleView'

/**
 * Jeden pokój na cały serwer (rodzinny). Kod niżej dalej umie wiele pokoi —
 * gdyby kiedyś było trzeba, wystarczy podnieść limit (i zdjąć „jedyny pokój” w obsłudze 'tv' / 'pad').
 */
const MAX_ROOMS = 1
/** ekrany na pokój: 2 telewizory + zapas na odświeżenie strony */
const MAX_TVS_PER_ROOM = 4
/** wszystkie połączenia naraz: 4 TV + 2 pady + zapas na reconnecty */
const DEFAULT_MAX_CONNECTIONS = 16
/** pad wysyła tylko zmiany stanu; więcej to błąd albo ktoś złośliwy */
const MAX_MESSAGES_PER_SECOND = 60
/** co tyle sprawdzamy, czy połączenie żyje; brak odpowiedzi do następnego razu = rozłączenie */
const HEARTBEAT_INTERVAL = 10_000
/** pusty pokój żyje jeszcze chwilę: TV po odświeżeniu strony wraca do tej samej gry */
const EMPTY_ROOM_TTL = 2 * 60 * 1000
/** pętla budzi się częściej niż krok logiki; akumulator i tak liczy równe kroki po 1/60 s */
const LOOP_INTERVAL = 4
const MAX_CATCH_UP = 250

/** wirtualne klawisze padów: prawdziwa klawiatura nigdy ich nie wygeneruje */
const PAD_CONTROLS: PlayerControl[] = Array.from({ length: PAD_SLOTS }, (_, slot) => ({
  up: `PartyPad${slot}Up`,
  down: `PartyPad${slot}Down`,
  left: `PartyPad${slot}Left`,
  right: `PartyPad${slot}Right`,
  fire: `PartyPad${slot}Fire`,
}))

/** wygląd i start każdego miejsca: Gracz 1 żółty … Gracz 4 fioletowy; start zależy od szerokości */
const slotLook = (slot: number, cols: number): Pick<PlayerConfig, 'color' | 'spawnPos'> => ({
  color: PLAYER_COLORS[slot],
  spawnPos: playerSpawns(cols)[slot],
})

/** szerokość planszy dla wyboru w lobby */
const colsOf = (stageIndex: number) =>
  stageIndex === WIDE_STAGE ? WIDE_FIELD_COLS : FIELD_BLOCK_SIZE

interface Pad {
  ws: WebSocket
  /** identyfikator telefonu; null dla starych klientów */
  device: string | null
  bits: number
  /** ogień wciśnięty od ostatniego kroku — szybkie stuknięcie mieści się między krokami */
  pendingPress: boolean
  turnSnap: number
}

interface RunningGame {
  session: GameSession
  /** gra na losowych planszach */
  random: boolean
  /** szerokość plansz tej gry (13 albo szeroka) */
  cols: number
  input: HostInput
  encoder: SceneEncoder
  sounds: SoundName[]
  playerOfSlot: (number | null)[]
  accumulator: number
  lastTime: number
  ticks: number
  sentTicks: number
  viewKey: string
  view: BattleView | null
  statisticsKey: string
  statistics: { view: StatisticsView; scores: number[] } | null
  /** nowe TV dostaje przy następnej klatce pełny widok */
  forceFull: boolean
  lives: number[]
}

interface Room {
  code: string
  tvs: Set<WebSocket>
  pads: (Pad | null)[]
  stageIndex: number
  /** poziom trudności wybrany przez pierwszego gracza */
  difficulty: number
  game: RunningGame | null
  paused: boolean
  lastResult: LanResult | null
  emptySince: number | null
  /** ustawienia trybu developera (przeżywają restart i zmianę planszy) */
  dev: { speed: number; botsOff: boolean; frozen: boolean; god: boolean[]; debug: boolean }
  /** scena, do której ostatnio zastosowano ustawienia dev */
  devScene: unknown
}

/** poziom trudności o krok w górę / w dół (bez zawijania: z Koszmaru nie skacze na Łatwy) */
function nextDifficulty(current: number, delta: number): number {
  return Math.min(DIFFICULTY_LEVELS.length - 1, Math.max(0, current + Math.sign(delta)))
}

/** wybór planszy w lobby: -1 = losowa, potem 1…35 (w kółko) */
function nextStage(current: number, delta: number): number {
  // -2 losowe szerokie, -1 losowe, 0…34 plansze oryginału (w kółko)
  const n = stages.length + 2
  return ((((current + 2 + Math.sign(delta)) % n) + n) % n) - 2
}

function stageLabel(index: number): string {
  return index === WIDE_STAGE ? 'losowa szeroka' : index < 0 ? 'losowa' : stages[index].name
}

const send = (ws: WebSocket | undefined | null, msg: PartyServerMessage | string) => {
  if (ws != null && ws.readyState === ws.OPEN)
    ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
}

export interface PartyServerOptions {
  /** rodzinny klucz z adresu (?k=…); null = bez klucza, tylko do testów lokalnych */
  key?: string | null
  maxConnections?: number
  /**
   * zdarzenia rozgrywki z identyfikatorem gracza = identyfikatorem telefonu;
   * tu podepną się profile, doświadczenie i osiągnięcia
   */
  onGameEvent?: (event: GameEvent) => void
  /**
   * tryb developera: polecenia 'dev' (poziom czołgu, statystyki, nieśmiertelność…);
   * nigdy na serwerze publicznym
   */
  dev?: {
    saveStats: (stats: PlayerLevelStats[]) => Promise<void>
    loadStats: () => Promise<PlayerLevelStats[] | null>
  }
}

const digest = (text: string) => createHash('sha256').update(text).digest()

function keyMatches(expected: string, given: string | null): boolean {
  return given != null && timingSafeEqual(digest(expected), digest(given))
}

export function createPartyServer({
  key = null,
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  onGameEvent,
  dev,
}: PartyServerOptions = {}) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: { threshold: 0 },
  })
  const rooms = new Map<string, Room>()
  // Postęp należy do procesu serwera, także po zakończeniu gry i usunięciu pustego pokoju.
  const xp = new SessionXp()
  const memberOf = new Map<WebSocket, Room>()

  const newCode = (): string | null => {
    for (let i = 0; i < 100; i += 1) {
      const code = String(1000 + Math.floor(Math.random() * 9000))
      if (!rooms.has(code)) return code
    }
    return null
  }

  /** przy jednym pokoju kod jest tylko informacją — pad ze starym QR i tak trafi do gry */
  const onlyRoom = (): Room | undefined =>
    MAX_ROOMS === 1 ? rooms.values().next().value : undefined

  const createRoom = (code: string): Room => {
    const room: Room = {
      code,
      tvs: new Set(),
      pads: new Array<Pad | null>(PAD_SLOTS).fill(null),
      stageIndex: 0,
      difficulty: DEFAULT_DIFFICULTY,
      game: null,
      paused: false,
      lastResult: null,
      emptySince: null,
      dev: {
        speed: 1,
        botsOff: false,
        frozen: false,
        god: new Array<boolean>(PAD_SLOTS).fill(false),
        debug: false,
      },
      devScene: null,
    }
    rooms.set(code, room)
    return room
  }

  /** „pierwszy gracz” = najniższy zajęty slot (zwykle Gracz 1) */
  const difficultyChooser = (room: Room): number | null => {
    const slot = room.pads.findIndex((p) => p != null)
    return slot === -1 ? null : slot
  }

  const stateOf = (room: Room): PartyRoomState => ({
    code: room.code,
    pads: room.pads.map((p) => p != null),
    tvs: room.tvs.size,
    stage: stageLabel(room.stageIndex),
    stageIndex: room.stageIndex,
    fieldCols: room.game?.cols ?? colsOf(room.stageIndex),
    stageCount: stages.length,
    playing: room.game != null,
    paused: room.paused,
    playerOfSlot: room.game?.playerOfSlot ?? room.pads.map(() => null),
    lastResult: room.lastResult,
    difficulty: room.difficulty,
    difficultyNames: DIFFICULTY_LEVELS.map((d) => d.nazwa),
    difficultyChooser: difficultyChooser(room),
    xp: xp.snapshot(),
  })

  const broadcastRoom = (room: Room) => {
    const text = JSON.stringify({ t: 'room', room: stateOf(room) } satisfies PartyServerMessage)
    for (const ws of room.tvs) send(ws, text)
    for (const pad of room.pads) send(pad?.ws, text)
  }

  const startGame = (room: Room) => {
    if (room.game != null) return
    const playerOfSlot: (number | null)[] = room.pads.map(() => null)
    const players: PlayerConfig[] = []
    const cols = colsOf(room.stageIndex)
    room.pads.forEach((pad, slot) => {
      if (pad == null) return
      playerOfSlot[slot] = players.length
      // gracz = telefon: ten sam telefon to ten sam gracz także w kolejnych grach
      players.push({
        id: pad.device ?? `slot-${slot + 1}`,
        control: PAD_CONTROLS[slot],
        ...slotLook(slot, cols),
      })
    })
    if (players.length === 0) return
    const sounds: SoundName[] = []
    const audio: AudioPort = { play: (name) => sounds.push(name) }
    // plansza -1 = losowe: cała seria nowych, wylosowanych plansz (R1, R2…)
    const random = room.stageIndex < 0
    const list = random ? randomCampaign(stages.length, Math.random, cols) : stages
    const session = new GameSession(list, random ? 0 : room.stageIndex, players, audio, {
      autopilot: false,
      random: Math.random,
      difficulty: room.difficulty,
      sessionBonuses: () => xp.bonuses(),
      events: {
        emit: (event) => {
          if (xp.record(event)) broadcastRoom(room)
          try {
            onGameEvent?.(event)
          } catch (err) {
            // błąd w statystykach nie może zatrzymać gry
            console.error('onGameEvent:', err)
          }
        },
      },
    })
    room.game = {
      session,
      random,
      cols,
      input: new HostInput(PAD_CONTROLS),
      encoder: new SceneEncoder(),
      sounds,
      playerOfSlot,
      accumulator: 0,
      lastTime: performance.now(),
      ticks: 0,
      sentTicks: -1,
      viewKey: '',
      view: null,
      statisticsKey: '',
      statistics: null,
      forceFull: true,
      lives: [],
    }
    room.paused = false
    room.lastResult = null
    for (const ws of room.tvs) send(ws, { t: 'start' })
    broadcastRoom(room)
  }

  const stopGame = (room: Room, result: LanResult | null) => {
    room.game = null
    room.paused = false
    if (result != null) room.lastResult = result
    broadcastRoom(room)
  }

  const applyPads = (room: Room, game: RunningGame) => {
    room.pads.forEach((pad, slot) => {
      if (game.playerOfSlot[slot] == null) return
      const held = pad == null ? 0 : pad.bits
      const sample: InputSample = { ...decodeInput(held), firePressed: pad?.pendingPress ?? false }
      const scene = game.session.scene
      const tank = scene?.tanks.find(
        (t) => t.alive && t.side === 'player' && t.color === PLAYER_COLORS[slot],
      )
      if (
        scene != null &&
        tank != null &&
        pad != null &&
        sample.direction != null &&
        isPerpendicular(sample.direction, tank.direction)
      ) {
        alignTurn(
          {
            map: scene.map,
            tanks: scene.tanks,
            restrictedAreas: scene.flickers.map((f) => f.tank.rect()),
          },
          tank,
          pad.turnSnap,
          sample.direction,
        )
      }
      if ((held & INPUT_TURN_ONLY) !== 0 && sample.direction != null) {
        // obrót w miejscu: kierunek trzymamy tylko, dopóki czołg tam nie patrzy — silnik wtedy
        // skręca, a nie jedzie; gdy już patrzy, puszczamy klawisz i czołg stoi
        if (tank == null || tank.direction === sample.direction) sample.direction = null
      }
      game.input.applyRemote(sample, PAD_CONTROLS[slot])
      if (pad != null) pad.pendingPress = false
    })
  }

  const stepRoom = (room: Room, now: number) => {
    const game = room.game
    if (game == null) return
    const delta = Math.min(now - game.lastTime, MAX_CATCH_UP)
    game.lastTime = now
    if (room.paused) return
    game.accumulator += delta * room.dev.speed
    while (game.accumulator >= STEP_MS) {
      applyPads(room, game)
      game.session.step(STEP_MS, game.input)
      game.input.endTick()
      game.ticks += 1
      game.accumulator -= STEP_MS
      if (dev != null) applyDevSettings(room, game)
    }
    if (game.ticks !== game.sentTicks) {
      game.sentTicks = game.ticks
      broadcastFrame(room, game)
    }
    const s = game.session
    if (s.phase === 'ended') {
      stopGame(room, { stageName: s.stage.name, scores: s.scores, cleared: s.cleared })
    }
  }

  /** ustawienia dev działają też po zmianie planszy i odrodzeniu czołgu */
  const applyDevSettings = (room: Room, game: RunningGame) => {
    const scene = game.session.scene
    if (scene == null) return
    if (scene !== room.devScene) {
      room.devScene = scene
      scene.devSetBotsEnabled(!room.dev.botsOff)
      if (room.dev.frozen) scene.devFreezeBots(true)
    }
    room.dev.god.forEach((on, slot) => {
      const index = game.playerOfSlot[slot]
      if (on && index != null) scene.devSetInvincible(index, true)
    })
  }

  const broadcastFrame = (room: Room, game: RunningGame) => {
    const s = game.session
    if (game.forceFull) game.encoder.reset()
    const msg: FrameMessage = { t: 'f', scene: game.encoder.encode(s.scene) }

    const view = toView(s)
    const viewKey = JSON.stringify(view)
    if (viewKey !== game.viewKey || game.forceFull) {
      game.viewKey = viewKey
      game.view = view
      msg.view = view
    }
    const statistics =
      s.statistics == null ? null : { view: structuredClone(s.statistics), scores: [...s.scores] }
    const statisticsKey = statistics == null ? '' : JSON.stringify(statistics)
    if (statisticsKey !== game.statisticsKey || game.forceFull) {
      game.statisticsKey = statisticsKey
      game.statistics = statistics
      msg.statistics = statistics
    }
    if (game.sounds.length > 0) msg.sounds = game.sounds.splice(0)
    if (dev != null && room.dev.debug && s.scene != null) msg.debug = s.scene.devDebug()
    game.forceFull = false

    const text = JSON.stringify(msg)
    for (const ws of room.tvs) send(ws, text)

    // pad brzęczy, gdy jego czołg straci życie
    view.lives.forEach((lives, player) => {
      const before = game.lives[player]
      if (before != null && lives < before) {
        const slot = game.playerOfSlot.indexOf(player)
        send(room.pads[slot]?.ws, { t: 'buzz', ms: 300 })
      }
    })
    game.lives = view.lives
  }

  const leave = (ws: WebSocket) => {
    const room = memberOf.get(ws)
    if (room == null) return
    memberOf.delete(ws)
    room.tvs.delete(ws)
    room.pads = room.pads.map((pad) => (pad?.ws === ws ? null : pad))
    if (room.tvs.size === 0 && room.pads.every((p) => p == null)) room.emptySince = Date.now()
    broadcastRoom(room)
  }

  const join = (ws: WebSocket, room: Room) => {
    leave(ws)
    memberOf.set(ws, room)
    room.emptySince = null
  }

  /** okna trybu developera — dostają stan gry kilka razy na sekundę */
  const devClients = new Set<WebSocket>()

  const sendTankConfig = (room: Room | undefined) => {
    if (room == null) return
    const text = JSON.stringify({ t: 'tank-config', stats: playerStatsTable() })
    for (const ws of room.tvs) send(ws, text)
  }

  const restartGame = (room: Room) => {
    // restart losowej gry = nowe losowe plansze; zwykłej — ta sama plansza
    if (room.game != null && !room.game.random) room.stageIndex = room.game.session.stageIndex
    room.game = null
    room.paused = false
    startGame(room)
  }

  const devState = (room: Room | undefined): DevState | null => {
    if (room == null) return null
    const game = room.game
    const scenePlayers = game?.session.scene?.devPlayers() ?? []
    return {
      playing: game != null,
      paused: room.paused,
      stageIndex: game != null && !game.random ? game.session.stageIndex : room.stageIndex,
      stageCount: stages.length,
      stageName: game != null ? game.session.stage.name : stageLabel(room.stageIndex),
      difficulty: room.difficulty,
      difficultyName: DIFFICULTY_LEVELS[room.difficulty].nazwa,
      speed: room.dev.speed,
      botsOff: room.dev.botsOff,
      frozen: room.dev.frozen,
      debug: room.dev.debug,
      players: room.pads.map((pad, slot) => {
        const index = game?.playerOfSlot[slot] ?? null
        const p = index == null ? null : scenePlayers[index]
        return {
          slot,
          connected: pad != null,
          inGame: index != null,
          rank: p?.rank ?? 0,
          lives: p?.lives ?? 0,
          alive: p?.alive ?? false,
          invincible: room.dev.god[slot] ?? false,
        }
      }),
    }
  }

  const onDev = async (ws: WebSocket, action: DevAction) => {
    if (dev == null) return
    devClients.add(ws)
    const room = onlyRoom()
    const scene = room?.game?.session.scene ?? null
    // slot (Gracz 1/2) → indeks gracza w bieżącej grze
    const player = (slot: number) => room?.game?.playerOfSlot[slot] ?? -1
    const reply = (ok: boolean, message: string) => send(ws, { t: 'dev-result', ok, message })
    switch (action.a) {
      case 'stats':
        send(ws, { t: 'dev-stats', stats: playerStatsTable() })
        return
      case 'set-stats':
        send(ws, { t: 'dev-stats', stats: setPlayerStatsTable(action.stats) })
        sendTankConfig(room)
        return
      case 'save-stats':
        try {
          await dev.saveStats(playerStatsTable())
          reply(true, 'Zapisano config/czolgi.json')
        } catch (err) {
          reply(false, `Nie udało się zapisać: ${String(err)}`)
        }
        return
      case 'load-stats': {
        const stats = await dev.loadStats()
        if (stats != null) setPlayerStatsTable(stats)
        send(ws, { t: 'dev-stats', stats: playerStatsTable() })
        sendTankConfig(room)
        reply(stats != null, stats != null ? 'Wczytano z pliku' : 'Brak pliku konfiguracji')
        return
      }
    }
    if (room == null) {
      reply(false, 'Najpierw otwórz grę (TV / PC)')
      return
    }
    switch (action.a) {
      case 'rank':
        scene?.devSetRank(player(action.slot), Number(action.rank))
        return
      case 'life':
        scene?.devAddLife(player(action.slot))
        return
      case 'god':
        room.dev.god[action.slot] = action.on === true
        if (!room.dev.god[action.slot]) scene?.devSetInvincible(player(action.slot), false)
        return
      case 'powerup':
        scene?.devSpawnPowerUp(player(action.slot), action.name)
        return
      case 'kill-player':
        scene?.devKillPlayer(player(action.slot))
        return
      case 'kill-bots':
        scene?.devKillAllBots()
        return
      case 'freeze-bots':
        room.dev.frozen = action.on === true
        scene?.devFreezeBots(room.dev.frozen)
        return
      case 'bots':
        room.dev.botsOff = action.on !== true
        scene?.devSetBotsEnabled(!room.dev.botsOff)
        return
      case 'start':
        if (room.game == null) startGame(room)
        if (room.game == null) reply(false, 'Brak graczy — dołącz klawiaturą / padem / telefonem')
        return
      case 'stop':
        if (room.game != null) stopGame(room, null)
        return
      case 'restart':
        restartGame(room)
        if (room.game == null) reply(false, 'Brak graczy — dołącz klawiaturą / padem / telefonem')
        return
      case 'pause':
        if (room.game != null) {
          room.paused = !room.paused
          room.game.lastTime = performance.now()
          broadcastRoom(room)
        }
        return
      case 'stage': {
        const current =
          room.game != null && !room.game.random ? room.game.session.stageIndex : room.stageIndex
        room.stageIndex = nextStage(current, Number(action.delta))
        if (room.game != null) {
          room.game = null
          startGame(room)
        } else {
          broadcastRoom(room)
        }
        return
      }
      case 'difficulty':
        room.difficulty = nextDifficulty(room.difficulty, Number(action.delta))
        broadcastRoom(room)
        return
      case 'debug':
        room.dev.debug = action.on === true
        return
      case 'speed':
        room.dev.speed = Math.min(4, Math.max(0.1, Number(action.value) || 1))
        return
    }
  }

  const onMessage = (ws: WebSocket, msg: PartyClientMessage) => {
    const room = memberOf.get(ws)
    if (msg.t === 'dev') {
      void onDev(ws, msg.action ?? { a: 'stats' })
      return
    }
    switch (msg.t) {
      case 'tv': {
        // jedyny pokój: każde TV trafia do już istniejącego, nawet ze starym kodem z zakładki
        let target: Room | undefined =
          (isRoomCode(msg.code) ? rooms.get(msg.code) : undefined) ?? onlyRoom()
        if (target == null && rooms.size < MAX_ROOMS) {
          // po restarcie serwera TV z zakładki wraca pod swój stary kod
          const code = isRoomCode(msg.code) ? msg.code : newCode()
          if (code != null) target = createRoom(code)
        }
        if (target == null) {
          send(ws, { t: 'error', message: 'Za dużo pokoi na serwerze' })
          return
        }
        if (!target.tvs.has(ws) && target.tvs.size >= MAX_TVS_PER_ROOM) {
          send(ws, { t: 'error', message: 'Za dużo ekranów w pokoju' })
          return
        }
        join(ws, target)
        target.tvs.add(ws)
        send(ws, { t: 'joined', role: 'tv', code: target.code, slot: null })
        send(ws, { t: 'tank-config', stats: playerStatsTable() })
        if (target.game != null) {
          send(ws, { t: 'start' })
          target.game.forceFull = true
        }
        broadcastRoom(target)
        return
      }
      case 'pad': {
        const target = (isRoomCode(msg.code) ? rooms.get(msg.code) : undefined) ?? onlyRoom()
        if (target == null) {
          send(ws, { t: 'error', message: 'Najpierw włącz grę na telewizorze' })
          return
        }
        const device =
          typeof msg.device === 'string' && /^[\w-]{8,64}$/.test(msg.device) ? msg.device : null
        const wanted =
          typeof msg.slot === 'number' && msg.slot >= 0 && msg.slot < PAD_SLOTS ? msg.slot : null
        const free = target.pads.flatMap((p, i) => (p == null || p.ws === ws ? [i] : []))
        // ten sam telefon (druga karta, podgląd z aparatu, zerwane połączenie) zastępuje sam siebie
        const ownSlot =
          device == null ? -1 : target.pads.findIndex((p) => p != null && p.device === device)
        let slot: number | null = null
        if (ownSlot !== -1) slot = ownSlot
        else if (wanted != null && free.includes(wanted)) slot = wanted
        else if (free.length > 0) slot = free[0]
        else if (msg.takeover === true && wanted != null) slot = wanted
        if (slot == null) {
          send(ws, { t: 'error', message: 'Wszystkie pady są zajęte', code: 'full' })
          return
        }
        const previous = target.pads[slot]
        if (previous != null && previous.ws !== ws) {
          // zwalniamy slot od razu, bez czekania na zamknięcie starego połączenia
          leave(previous.ws)
          previous.ws.close(CLOSE_REPLACED, 'replaced')
        }
        join(ws, target)
        target.pads[slot] = {
          ws,
          device,
          bits: 0,
          pendingPress: false,
          turnSnap: 8,
        }
        send(ws, { t: 'joined', role: 'pad', code: target.code, slot })
        broadcastRoom(target)
        return
      }
    }

    if (room == null) return
    const pad = room.pads.find((p) => p?.ws === ws)
    if (msg.t === 'xp-config' || msg.t === 'xp-buy') {
      // Wspólny ekran albo pierwszy gracz zarządza wspólną pulą.
      const manager =
        room.tvs.has(ws) || (pad != null && room.pads.indexOf(pad) === difficultyChooser(room))
      if (!manager) return
      const changed =
        msg.t === 'xp-config' ? room.game == null && xp.configure(msg.config) : xp.buy(msg.trait)
      if (changed) {
        room.game?.session.scene?.refreshSessionBonuses()
        broadcastRoom(room)
        if (room.game != null) broadcastFrame(room, room.game)
      }
      return
    }
    if (pad == null) return
    switch (msg.t) {
      case 'in': {
        const bits = Number(msg.b) & (0b1111 | INPUT_TURN_ONLY)
        if ((bits & 8) !== 0 && (pad.bits & 8) === 0) pad.pendingPress = true
        pad.bits = bits
        return
      }
      case 'sensitivity':
        if (validTurnSnap(msg.turnSnap)) pad.turnSnap = msg.turnSnap
        return
      case 'start':
        startGame(room)
        return
      case 'stage':
        // planszę (też losowe / szerokie) wybiera pierwszy gracz
        if (room.game == null && room.pads.indexOf(pad) === difficultyChooser(room)) {
          room.stageIndex = nextStage(room.stageIndex, Number(msg.delta))
          broadcastRoom(room)
        }
        return
      case 'difficulty':
        // w trakcie gry też można: nowy poziom wchodzi przy restarcie / następnej grze
        if (room.pads.indexOf(pad) === difficultyChooser(room)) {
          room.difficulty = nextDifficulty(room.difficulty, Number(msg.delta))
          broadcastRoom(room)
        }
        return
      case 'pause':
        if (room.game != null) {
          room.paused = !room.paused
          room.game.lastTime = performance.now()
          room.game.sounds.push('pause')
          broadcastFrame(room, room.game)
          broadcastRoom(room)
        }
        return
      case 'quit':
        if (room.game != null) stopGame(room, null)
        return
      case 'restart':
        if (room.game != null && room.pads.indexOf(pad) === difficultyChooser(room)) {
          restartGame(room)
          broadcastRoom(room)
        }
        return
    }
  }

  /** połączenia, które odpowiedziały na ostatni ping */
  const alive = new WeakSet<WebSocket>()

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    alive.add(ws)
    ws.on('pong', () => alive.add(ws))
    if (key != null) {
      const given = new URL(req.url ?? '/', 'http://localhost').searchParams.get('k')
      if (!keyMatches(key, given)) {
        send(ws, { t: 'error', message: 'Brak dostępu: otwórz link z rodzinnym kluczem' })
        ws.close(CLOSE_BAD_KEY, 'bad key')
        return
      }
    }
    let windowStart = Date.now()
    let count = 0
    ws.on('message', (data, isBinary) => {
      const now = Date.now()
      if (now - windowStart >= 1000) {
        windowStart = now
        count = 0
      }
      count += 1
      if (count > MAX_MESSAGES_PER_SECOND) {
        ws.terminate()
        return
      }
      if (isBinary) return
      let msg: PartyClientMessage
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (typeof msg?.t === 'string') onMessage(ws, msg)
    })
    ws.on('close', () => {
      leave(ws)
      devClients.delete(ws)
    })
  })

  // martwe połączenia (telefon zgasł, karta w tle, padło Wi-Fi) nie trzymają slotu w nieskończoność
  const devTimer =
    dev == null
      ? 0
      : setInterval(() => {
          if (devClients.size === 0) return
          const state = devState(onlyRoom())
          if (state == null) return
          const text = JSON.stringify({ t: 'dev-state', state } satisfies PartyServerMessage)
          for (const ws of devClients) send(ws, text)
        }, 250)

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate()
        continue
      }
      alive.delete(ws)
      ws.ping()
    }
  }, HEARTBEAT_INTERVAL)

  const loop = setInterval(() => {
    const now = performance.now()
    for (const room of rooms.values()) {
      if (room.emptySince != null && Date.now() - room.emptySince > EMPTY_ROOM_TTL) {
        rooms.delete(room.code)
        continue
      }
      stepRoom(room, now)
    }
  }, LOOP_INTERVAL)

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost')
      if (pathname !== PARTY_PATH) return false
      if (wss.clients.size >= maxConnections) {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
        return true
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
      return true
    },
    rooms: () => rooms.size,
    close() {
      clearInterval(loop)
      clearInterval(heartbeat)
      if (devTimer !== 0) clearInterval(devTimer)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}

export type PartyServer = ReturnType<typeof createPartyServer>
