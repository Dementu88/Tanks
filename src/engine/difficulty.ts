import config from '../../config/gra.json'
import type { TankLevel } from './types'

/**
 * Trudność (config/gra.json): liczba graczy (1–4) i poziom wybrany przez Gracza 1.
 * Poziom „Normalny” przy 1–2 graczach daje dokładnie oryginał: 20 wrogów, 4 / 6 naraz,
 * bonusy na 4., 11. i 18. wrogu, 3 życia.
 */
export const MAX_PLAYERS = 4

export interface DifficultyLevel {
  nazwa: string
  /** mnożnik liczby wrogów */
  wrogowie: number
  /** ilu więcej wrogów naraz na planszy */
  naPlanszy: number
  /** mnożnik odstępu pojawiania się wrogów (mniej = szybciej) */
  tempo: number
  /** co ilu wrogów jeden niesie bonus */
  bonusCo: number
  /** życia na start */
  zycia: number
  /** jaka część wrogów jest o stopień mocniejsza (0–1) */
  ulepszenia: number
}

const NORMAL: DifficultyLevel = {
  nazwa: 'Normalny',
  wrogowie: 1,
  naPlanszy: 0,
  tempo: 1,
  bonusCo: 7,
  zycia: 3,
  ulepszenia: 0,
}

const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

export const DIFFICULTY_LEVELS: DifficultyLevel[] = (
  Array.isArray(config.poziomy) && config.poziomy.length > 0 ? config.poziomy : [NORMAL]
).map((p: Partial<DifficultyLevel>) => ({
  nazwa: String(p.nazwa ?? NORMAL.nazwa),
  wrogowie: Math.max(0.1, num(p.wrogowie, 1)),
  naPlanszy: Math.round(num(p.naPlanszy, 0)),
  tempo: Math.max(0.1, num(p.tempo, 1)),
  bonusCo: Math.max(1, Math.round(num(p.bonusCo, 7))),
  zycia: Math.max(1, Math.round(num(p.zycia, 3))),
  ulepszenia: Math.min(1, Math.max(0, num(p.ulepszenia, 0))),
}))

export const DEFAULT_DIFFICULTY = Math.min(
  DIFFICULTY_LEVELS.length - 1,
  Math.max(0, Math.round(num(config.domyslnyPoziom, 1))),
)

export function difficulty(index: number | undefined): DifficultyLevel {
  const i = index == null ? DEFAULT_DIFFICULTY : Math.round(index)
  return DIFFICULTY_LEVELS[Math.min(DIFFICULTY_LEVELS.length - 1, Math.max(0, i))]
}

const pick = (list: unknown, players: number, fallback: number): number => {
  const arr = Array.isArray(list) ? list : []
  const v = Number(arr[Math.min(players, arr.length) - 1])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/** ilu wrogów naraz na planszy */
export function maxBotsOnField(players: number, level?: number): number {
  const base = Math.round(pick(config.wrogowieNaPlanszy, players, players > 1 ? 6 : 4))
  return Math.min(12, Math.max(2, base + difficulty(level).naPlanszy))
}

/** odstęp pojawiania się wrogów przeliczony przez poziom trudności */
export function spawnIntervalFactor(level?: number): number {
  return difficulty(level).tempo
}

/** życia graczy na start */
export function startLives(level?: number): number {
  return difficulty(level).zycia
}

const UPGRADE: Record<TankLevel, TankLevel> = {
  basic: 'fast',
  fast: 'power',
  power: 'armor',
  armor: 'armor',
}

/**
 * Kolejka wrogów planszy dla danej liczby graczy i poziomu: rozciągnięta proporcjonalnie
 * (kolejność typów zachowana — na początku słabsi, na końcu pancerni), a na wyższych poziomach
 * część wrogów o stopień mocniejsza, rozłożona równo po całej kolejce (bez losowania).
 */
export function scaleBots(bots: TankLevel[], players: number, level?: number): TankLevel[] {
  const d = difficulty(level)
  const factor = pick(config.wrogowieMnoznik, players, 1) * d.wrogowie
  const target = Math.max(1, Math.round(bots.length * factor))
  const scaled =
    target === bots.length
      ? [...bots]
      : Array.from({ length: target }, (_, i) => bots[Math.floor((i * bots.length) / target)])
  if (d.ulepszenia <= 0) return scaled
  // co k-ty wróg mocniejszy: złota proporcja daje równy rozkład bez skupisk
  return scaled.map((t, i) => (((i + 1) * 0.618034) % 1 < d.ulepszenia ? UPGRADE[t] : t))
}

/** czy wróg o danym numerze (od 0, w kolejności pojawiania się) niesie bonus */
export function carriesPowerUp(index: number, level?: number): boolean {
  const first = Math.max(0, Math.round(num(config.pierwszyBonus, 3)))
  const step = difficulty(level).bonusCo
  return index >= first && (index - first) % step === 0
}
