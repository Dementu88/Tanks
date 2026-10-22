import type { PlayerLevelStats } from '../engine/tankStats'
import type { XpConfig, XpState, XpTrait } from '../engine/sessionXp'
import type { PowerUpName } from '../engine/types'
import type { FrameMessage } from '../lan/frame'
import type { LanResult } from '../lan/protocol'

/**
 * Tryb „party”: gra liczy się na serwerze, telewizory tylko wyświetlają (dowolnie wiele),
 * telefony są padami (maks. 2). Wszyscy łączą się z tym samym pokojem po 4-cyfrowym kodzie.
 */
export const PARTY_PATH = '/party'

export const PAD_SLOTS = 4

/**
 * Bit w stanie pada (obok bitów z lan/input encodeInput): małe wychylenie joysticka —
 * czołg tylko obraca się w miejscu, nie jedzie.
 */
export const INPUT_TURN_ONLY = 32

/** kod zamknięcia WebSocketu: zły klucz — klient nie łączy się ponownie */
export const CLOSE_BAD_KEY = 4001
/** kod zamknięcia: slot przejął inny telefon — klient nie łączy się ponownie sam */
export const CLOSE_REPLACED = 4002

export type PartyRole = 'tv' | 'pad'

/** wybór „planszy” w lobby: losowe szerokie (cała seria, każda następna też szeroka i losowa) */
export const WIDE_STAGE = -2
/** wybór „planszy” w lobby: losowe zwykłe 13×13 */
export const RANDOM_STAGE = -1

export interface PartyRoomState {
  code: string
  /** czy pad danego slotu (Ⅰp, Ⅱp) jest podłączony */
  pads: boolean[]
  tvs: number
  /** nazwa startowej planszy */
  stage: string
  /** -1 = losowe plansze, -2 = losowe szerokie (WIDE_STAGE) */
  stageIndex: number
  /** szerokość planszy trwającej gry (albo wybranej w lobby): 13 lub szeroka */
  fieldCols: number
  stageCount: number
  playing: boolean
  paused: boolean
  /** który slot zajmuje czołg w trwającej grze; null = slot nie gra */
  playerOfSlot: (number | null)[]
  lastResult: LanResult | null
  /** poziom trudności (indeks w config/gra.json „poziomy”) */
  difficulty: number
  difficultyNames: string[]
  /** slot, który wybiera poziom (pierwszy podłączony gracz); null = nikt */
  difficultyChooser: number | null
  xp?: XpState
}

/** serwer → klient */
export type PartyServerMessage =
  | { t: 'joined'; role: PartyRole; code: string; slot: number | null }
  | { t: 'room'; room: PartyRoomState }
  /** code 'full': oba sloty zajęte — pad może je przejąć (takeover) */
  | { t: 'error'; message: string; code?: 'full' }
  /** tylko do TV: zaczyna się nowa gra (albo TV dołączyło w trakcie), stwórz nowe lustro */
  | { t: 'start' }
  /** tylko do TV */
  | FrameMessage
  /** do padów: krótka wibracja, np. trafienie */
  | { t: 'buzz'; ms: number }
  /** do TV: tabela czołgów LV1–LV5 (m.in. skala grafiki) — przy dołączeniu i po zmianie */
  | { t: 'tank-config'; stats: PlayerLevelStats[] }
  /** tryb developera: aktualna tabela statystyk LV1–LV5 */
  | { t: 'dev-stats'; stats: PlayerLevelStats[] }
  /** tryb developera: wynik operacji (zapis do pliku itd.) */
  | { t: 'dev-result'; ok: boolean; message: string }
  /** tryb developera: stan gry i graczy (kilka razy na sekundę) */
  | { t: 'dev-state'; state: DevState }

/** klient → serwer */
export type PartyClientMessage =
  /** TV bez kodu zakłada nowy pokój */
  | { t: 'tv'; code?: string }
  /**
   * pad dołącza; slot to preferowane miejsce (po odświeżeniu strony wraca na swoje),
   * device — stały identyfikator telefonu (ten sam telefon zastępuje swoje stare połączenie),
   * takeover — przejmij slot, nawet jeśli zajmuje go inny telefon
   */
  | { t: 'pad'; code: string; slot?: number; device?: string; takeover?: boolean }
  /** stan pada: bity jak w lan/input encodeInput (kierunek + wciśnięty ogień) */
  | { t: 'in'; b: number }
  | { t: 'sensitivity'; turnSnap: number }
  | { t: 'xp-config'; config: XpConfig }
  | { t: 'xp-buy'; trait: XpTrait }
  | { t: 'start' }
  | { t: 'stage'; delta: number }
  /** poprzedni / następny poziom trudności — tylko pierwszy gracz; w grze działa od restartu */
  | { t: 'difficulty'; delta: number }
  /** restart bieżącej gry — tylko pierwszy gracz (menu) */
  | { t: 'restart' }
  | { t: 'pause' }
  | { t: 'quit' }
  /** tryb developera (tylko serwer lokalny / PARTY_DEV=1) */
  | { t: 'dev'; action: DevAction }

/** polecenia trybu developera; slot = gracz (0 = Gracz 1) */
export type DevAction =
  | { a: 'stats' }
  | { a: 'set-stats'; stats: PlayerLevelStats[] }
  | { a: 'save-stats' }
  | { a: 'load-stats' }
  | { a: 'rank'; slot: number; rank: number }
  | { a: 'life'; slot: number }
  | { a: 'god'; slot: number; on: boolean }
  | { a: 'kill-bots' }
  | { a: 'freeze-bots'; on: boolean }
  /** wrogowie przestają się pojawiać */
  | { a: 'bots'; on: boolean }
  | { a: 'powerup'; slot: number; name: PowerUpName }
  | { a: 'kill-player'; slot: number }
  | { a: 'start' }
  | { a: 'stop' }
  | { a: 'restart' }
  | { a: 'pause' }
  /** poprzednia / następna plansza; w trakcie gry od razu ją uruchamia */
  | { a: 'stage'; delta: number }
  /** poziom trudności; działa od następnego startu / restartu */
  | { a: 'difficulty'; delta: number }
  /** tempo gry: 0.25 = cztery razy wolniej (podgląd animacji), 2 = dwa razy szybciej */
  | { a: 'speed'; value: number }
  /** „pokaż zaawansowane”: trasy i cele AI na ekranie gry */
  | { a: 'debug'; on: boolean }

export interface DevPlayerState {
  slot: number
  /** pad podłączony (telefon / klawiatura / pad) */
  connected: boolean
  /** gra w bieżącej rozgrywce */
  inGame: boolean
  rank: number
  lives: number
  alive: boolean
  invincible: boolean
}

export interface DevState {
  playing: boolean
  paused: boolean
  stageIndex: number
  stageCount: number
  stageName: string
  difficulty: number
  difficultyName: string
  speed: number
  botsOff: boolean
  frozen: boolean
  /** podgląd tras AI włączony */
  debug: boolean
  players: DevPlayerState[]
}

/** kod pokoju w adresie: #/tv/1234, #/pad/1234 */
export function isRoomCode(code: unknown): code is string {
  return typeof code === 'string' && /^\d{4}$/.test(code)
}
