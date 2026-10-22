import gameConfig from '../../config/gra.json'
import { GAMEPLAY } from './gameplayConfig'
import type { TankColor, TankLevel } from './types'

/** n 帧对应的毫秒数；原版按 60fps 逐帧计时 */
export const frame = (n: number): number => (1000 / 60) * n

/** 一个 block 对应 16 像素 */
export const BLOCK_SIZE = 16
/** 坦克的大小 */
export const TANK_SIZE = BLOCK_SIZE
/** 战场的大小（13 block × 13 block）— wysokość planszy zawsze 13, szerokość zmienna (FIELD_COLS) */
export const FIELD_BLOCK_SIZE = 13
/** wysokość planszy w px (208); szerokość to FIELD_WIDTH */
export const FIELD_SIZE = BLOCK_SIZE * FIELD_BLOCK_SIZE
/**
 * szeroka plansza (losowe dla większej liczby graczy): config/gra.json „szerokaPlansza”
 * (domyślnie 21 kratek); nieparzysta, żeby orzeł był na środku
 */
export const WIDE_FIELD_COLS = ((): number => {
  const v = Math.round(Number((gameConfig as { szerokaPlansza?: unknown }).szerokaPlansza))
  const cols = Number.isFinite(v) ? Math.min(31, Math.max(15, v)) : 21
  return cols % 2 === 1 ? cols : cols + 1
})()
/** 子弹的大小 */
export const BULLET_SIZE = 3
/** 摧毁 steel 所需的最低子弹 power 值 */
export const STEEL_POWER = 3

/** 渲染缩放倍数 */
export const ZOOM_LEVEL = 2
/** 屏幕逻辑尺寸（含右侧 HUD 区，16×15 block） */
export const SCREEN_HEIGHT = 15 * BLOCK_SIZE

/**
 * 坦克配色方案：黄 / 绿 / 银 / 红。
 * 每种方案 a 浅色、b 一般色、c 深色。
 */
export const TANK_COLOR_SCHEMES: Record<TankColor, { a: string; b: string; c: string }> = {
  yellow: { a: '#E7E794', b: '#E79C21', c: '#6B6B00' },
  green: { a: '#B5F7CE', b: '#008C31', c: '#005200' },
  silver: { a: '#FFFFFF', b: '#ADADAD', c: '#00424A' },
  red: { a: '#FFFFFF', b: '#B53121', c: '#5A007B' },
  // gracze 3 i 4 — w tym samym stylu: jasny / główny / ciemny odcień
  blue: { a: '#BDE4FF', b: '#2F78E8', c: '#0B2E7A' },
  purple: { a: '#F4C6FF', b: '#B43AD6', c: '#4E0A63' },
}

/** 击杀坦克得分 */
export const TANK_KILL_SCORE_MAP: Record<TankLevel, number> = {
  basic: 100,
  fast: 200,
  power: 300,
  armor: 400,
}

/** 各类地形子格的边长（像素） */
export const ITEM_SIZE_MAP = {
  BRICK: 4,
  STEEL: 8,
  RIVER: BLOCK_SIZE,
  SNOW: BLOCK_SIZE,
  FOREST: BLOCK_SIZE,
} as const

type CellCounts = { BRICK: number; STEEL: number; RIVER: number; SNOW: number; FOREST: number }

const cellCounts = (px: number): CellCounts => ({
  BRICK: px / ITEM_SIZE_MAP.BRICK, // 52
  STEEL: px / ITEM_SIZE_MAP.STEEL, // 26
  RIVER: px / ITEM_SIZE_MAP.RIVER, // 13
  SNOW: px / ITEM_SIZE_MAP.SNOW, // 13
  FOREST: px / ITEM_SIZE_MAP.FOREST, // 13
})

/**
 * Szerokość bieżącej planszy. Zmienia ją tylko setFieldCols (wczytanie planszy, lustro TV);
 * importy są „żywe”, więc wszyscy widzą aktualną wartość. Na raz gra jest jedna (jeden pokój).
 */
export let FIELD_COLS = FIELD_BLOCK_SIZE
/** szerokość planszy w px */
export let FIELD_WIDTH = FIELD_SIZE
/** szerokość ekranu: plansza + ramka + panel HUD po prawej */
export let SCREEN_WIDTH = FIELD_WIDTH + 3 * BLOCK_SIZE
/** 各类地形铺满一整行所需的子格数量 (= krok indeksu w tablicach terenu) */
export let N_MAP: CellCounts = cellCounts(FIELD_WIDTH)
/** liczba wierszy podkratek (wysokość się nie zmienia) */
export const N_ROWS: CellCounts = cellCounts(FIELD_SIZE)
/** siatka punktów AI (co 8 px): kolumny / wiersze */
export let SPOT_COLS = FIELD_WIDTH / 8
export const SPOT_ROWS = FIELD_SIZE / 8

export const TANK_LEVELS: TankLevel[] = ['basic', 'fast', 'power', 'armor']

/** ustawia szerokość planszy (w kratkach 16 px) — przed wczytaniem / pokazaniem planszy */
export function setFieldCols(cols: number): void {
  const c = Math.max(FIELD_BLOCK_SIZE, Math.round(cols))
  if (c === FIELD_COLS) return
  FIELD_COLS = c
  FIELD_WIDTH = c * BLOCK_SIZE
  SCREEN_WIDTH = FIELD_WIDTH + 3 * BLOCK_SIZE
  N_MAP = cellCounts(FIELD_WIDTH)
  SPOT_COLS = FIELD_WIDTH / 8
  BOT_SPAWN_X = botSpawnX(c)
}

/** kolumna orła (środek planszy) */
export const eagleCol = (cols: number = FIELD_COLS): number => Math.floor(cols / 2)

/**
 * starty graczy 1–4 dla danej szerokości: 1 i 2 tuż przy orle, 3 i 4 dalej
 * (na planszy 13 dokładnie jak PLAYER_SPAWN_POS)
 */
export function playerSpawns(cols: number = FIELD_COLS): { x: number; y: number }[] {
  const e = eagleCol(cols)
  const far = cols > FIELD_BLOCK_SIZE ? 6 : 4
  return [e - 2, e + 2, e - far, e + far].map((c) => ({ x: c * BLOCK_SIZE, y: 12 * BLOCK_SIZE }))
}

/** 玩家出生点 */
export const PLAYER_SPAWN_POS = {
  player1: { x: 4 * BLOCK_SIZE, y: 12 * BLOCK_SIZE },
  player2: { x: 8 * BLOCK_SIZE, y: 12 * BLOCK_SIZE },
  // gracze 3 i 4: dalej od orła; plansza robi tam miejsce przy starcie (BattleScene)
  player3: { x: 2 * BLOCK_SIZE, y: 12 * BLOCK_SIZE },
  player4: { x: 10 * BLOCK_SIZE, y: 12 * BLOCK_SIZE },
} as const

/** punkty startu graczy po kolei (1–4) */
export const PLAYER_SPAWNS = [
  PLAYER_SPAWN_POS.player1,
  PLAYER_SPAWN_POS.player2,
  PLAYER_SPAWN_POS.player3,
  PLAYER_SPAWN_POS.player4,
] as const

/** kolory graczy po kolei (1–4) */
export const PLAYER_COLORS: TankColor[] = ['yellow', 'green', 'blue', 'purple']

/** 每累计 10000 分 +1 命 */
export const LIFE_BONUS_SCORE = 10000

/** bot 出生点（屏幕顶部三处，y 均为 0），按轮流顺序排列：中 → 右 → 左 */
function botSpawnX(cols: number): readonly number[] {
  const e = eagleCol(cols)
  const columns =
    cols > FIELD_BLOCK_SIZE
      ? // szeroka: jeszcze dwa wjazdy w ćwiartkach
        [e, cols - 1, 0, Math.floor(e / 2), cols - 1 - Math.floor(e / 2)]
      : [e, cols - 1, 0]
  return columns.map((c) => c * BLOCK_SIZE)
}
export let BOT_SPAWN_X: readonly number[] = botSpawnX(FIELD_BLOCK_SIZE)

/** 每关 20 个 bot 中携带道具的下标（从 0 计） */
export const POWER_UP_BOT_INDICES = [3, 10, 17]

/** 同时在场的 bot 上限（含正在出生、正在爆炸的） */
export const MAX_BOT_ON_FIELD = { single: 4, multi: 6 }

/** bot 出生间隔（帧 → ms）：190 − 4 × 关卡号，双人再减 20；第 35 关之后按第 35 关算 */
export function botSpawnInterval(stageNumber: number, multi: boolean): number {
  return frame(190 - 4 * Math.min(stageNumber, 35) - (multi ? 20 : 0))
}

/** bot 出生闪烁的总时长（帧 → ms），与关卡无关 */
export const BOT_FLICKER_DURATION = frame(56)

/** 击杀分数弹出的显示时长（帧 → ms） */
export const SCORE_POPUP_DURATION = frame(48)

/** 击杀坦克得分 */
export const POWER_UP_SCORE = 500

/** 玩家初始命数 */
export const INITIAL_LIVES = 3

/** 玩家复活无敌头盔时长（帧 → ms） */
export const SPAWN_HELMET_DURATION = GAMEPLAY.playerSpawnShieldMs
export const BOT_SPAWN_HELMET_DURATION = GAMEPLAY.enemySpawnShieldMs

/** 玩家托管：每关开战后一直没按键时，可操作满 START 就托管；按过键之后连续空闲 IDLE 托管（ms） */
export const AUTOPILOT_START = 2000
export const AUTOPILOT_IDLE = 5000

/** AI 判定「卡住」的超时（ms）与位移阈值 */
export const BLOCK_TIMEOUT = 200
export const BLOCK_DISTANCE_THRESHOLD = 0.01

/** armor 坦克拾取 star 的额外得分 */
export const STAR_ARMOR_SCORE = 5000
/** timer 道具：冻结计数与每次递减的间隔（帧 → ms）；计数按全局时钟的 64 帧边界递减，实际时长 576～640 帧 */
export const TIMER_FREEZE_TICKS = 10
export const TIMER_FREEZE_TICK = frame(64)
/**
 * 冰面（雪地）滑行，只作用于玩家坦克：在冰上从静止按下方向键时剩余滑行量置为 START（px），
 * 大于 LOCK 期间忽略方向键、沿朝向继续走；松开后滑完剩余量。
 * NES 是滑 28、剩余 ≥ 16 时锁定，试玩觉得太滑，减到约一个坦克长
 */
export const SNOW_SLIDE_START = 16
export const SNOW_SLIDE_LOCK = 8
/** helmet 道具的无敌时长（帧 → ms） */
export const HELMET_POWERUP_DURATION = GAMEPLAY.bonusShieldMs
/** shovel：变钢持续（帧 → ms）、闪烁间隔、闪烁次数 */
export const SHOVEL_STEEL_DURATION = frame(1076)
export const SHOVEL_BLINK_INTERVAL = frame(16)
export const SHOVEL_BLINK_TIMES = 6
