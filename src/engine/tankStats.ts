import config from '../../config/czolgi.json'
import type { TankLevel } from './types'

/**
 * Statystyki czołgu gracza na poziomach LV1–LV5 (kolejne gwiazdki w trakcie sesji).
 * Źródło: config/czolgi.json; tryb developera podmienia tabelę w locie (setPlayerStatsTable).
 * Wrogowie zostają przy klasycznych wartościach z values.ts.
 */
export interface PlayerLevelStats {
  /** px/ms */
  moveSpeed: number
  /** px/ms */
  bulletSpeed: number
  /** 3 i więcej przebija stal */
  bulletPower: number
  /** ms między strzałami */
  fireInterval: number
  /** ile pocisków naraz na planszy */
  bulletLimit: number
  /**
   * tylko wygląd: powiększenie grafiki z pliku względem kratki (1 = płótno 64 px na kratkę);
   * silnik i hitbox tego nie używają
   */
  spriteScale: number
}

export const MAX_RANK = 5

/**
 * Klasyczny „typ” czołgu dla każdego poziomu — z niego korzystają stare grafiki, AI
 * i statystyki zabójstw. Nowe grafiki LV1–LV5 rysujemy po samym poziomie.
 */
export const RANK_LEVEL: TankLevel[] = ['basic', 'fast', 'power', 'armor', 'armor']

export const STAT_LIMITS: Record<keyof PlayerLevelStats, { min: number; max: number }> = {
  moveSpeed: { min: 0.01, max: 0.2 },
  bulletSpeed: { min: 0.05, max: 0.6 },
  bulletPower: { min: 1, max: 5 },
  fireInterval: { min: 50, max: 2000 },
  bulletLimit: { min: 1, max: 6 },
  spriteScale: { min: 0.5, max: 2 },
}

const clamp = (v: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, v))

/** sprawdza i przycina tabelę z pliku albo z trybu developera; zawsze zwraca 5 poziomów */
export function normalizeStatsTable(raw: unknown): PlayerLevelStats[] {
  const rows = Array.isArray(raw) ? raw : []
  const result: PlayerLevelStats[] = []
  for (let i = 0; i < MAX_RANK; i += 1) {
    const row = (rows[i] ?? rows[rows.length - 1] ?? {}) as Partial<PlayerLevelStats>
    const fallback = DEFAULTS[i] ?? DEFAULTS[DEFAULTS.length - 1]
    const pick = (k: keyof PlayerLevelStats) => {
      const v = Number(row[k])
      return Number.isFinite(v) ? clamp(v, STAT_LIMITS[k]) : fallback[k]
    }
    result.push({
      moveSpeed: pick('moveSpeed'),
      bulletSpeed: pick('bulletSpeed'),
      bulletPower: Math.round(pick('bulletPower')),
      fireInterval: Math.round(pick('fireInterval')),
      bulletLimit: Math.round(pick('bulletLimit')),
      spriteScale: Math.round(pick('spriteScale') * 100) / 100,
    })
  }
  return result
}

/** wartości z oryginału — zapas, gdy w pliku czegoś brakuje */
const DEFAULTS: PlayerLevelStats[] = [
  {
    moveSpeed: 0.045,
    bulletSpeed: 0.12,
    bulletPower: 1,
    fireInterval: 300,
    bulletLimit: 1,
    spriteScale: 1.25,
  },
  {
    moveSpeed: 0.045,
    bulletSpeed: 0.18,
    bulletPower: 1,
    fireInterval: 200,
    bulletLimit: 1,
    spriteScale: 1.2,
  },
  {
    moveSpeed: 0.045,
    bulletSpeed: 0.18,
    bulletPower: 1,
    fireInterval: 200,
    bulletLimit: 2,
    spriteScale: 1.15,
  },
  {
    moveSpeed: 0.045,
    bulletSpeed: 0.18,
    bulletPower: 3,
    fireInterval: 200,
    bulletLimit: 2,
    spriteScale: 1.1,
  },
  {
    moveSpeed: 0.045,
    bulletSpeed: 0.18,
    bulletPower: 3,
    fireInterval: 200,
    bulletLimit: 2,
    spriteScale: 1.05,
  },
]

let table = normalizeStatsTable(config.gracz)

export function playerStats(rank: number): PlayerLevelStats {
  return table[Math.min(MAX_RANK, Math.max(1, rank)) - 1]
}

export function playerStatsTable(): PlayerLevelStats[] {
  return table.map((row) => ({ ...row }))
}

export function setPlayerStatsTable(raw: unknown): PlayerLevelStats[] {
  table = normalizeStatsTable(raw)
  return playerStatsTable()
}

/** poziom 1–5 dla klasycznego typu (np. stara rezerwa czołgu między planszami) */
export function rankOfLevel(level: TankLevel): number {
  return RANK_LEVEL.indexOf(level) + 1
}
