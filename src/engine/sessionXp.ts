import type { GameEvent } from './events'
import { CONFIGURED_XP, GAMEPLAY } from './gameplayConfig'

/** speed / fire / armor — od początku; bullet = szybsze pociski, shield = dłuższa tarcza po odrodzeniu */
export const XP_TRAITS = ['speed', 'fire', 'armor', 'bullet', 'shield'] as const
export const XP_COST_MIN = 1
export const XP_COST_MAX = 1000000
export type XpTrait = (typeof XP_TRAITS)[number]
export interface XpConfig {
  enabled: boolean
  costs: Record<XpTrait, number>
  speedPercent: number
  firePercent: number
  armorHp: number
  /** szybsze pociski: % na poziom */
  bulletPercent: number
  /** dłuższa tarcza po odrodzeniu: ms na poziom */
  shieldMs: number
}
export interface XpState {
  maxLevel: number
  config: XpConfig
  bank: number
  earned: number
  levels: Record<XpTrait, number>
}
export interface SessionBonuses {
  speedMultiplier: number
  fireRateMultiplier: number
  extraHp: number
  bulletSpeedMultiplier: number
  /** dodatkowa tarcza po odrodzeniu (ms) */
  extraShieldMs: number
}
export const NO_SESSION_BONUSES: SessionBonuses = {
  speedMultiplier: 1,
  fireRateMultiplier: 1,
  extraHp: 0,
  bulletSpeedMultiplier: 1,
  extraShieldMs: 0,
}
/** zakresy premii na poziom (walidacja pliku i suwaków w lobby) */
export const XP_BONUS_RANGES = {
  speedPercent: [5, 50],
  firePercent: [5, 50],
  armorHp: [1, 3],
  bulletPercent: [5, 50],
  shieldMs: [250, 5000],
} as const
/** starszy config/rozgrywka.json nie zna dwóch nowych cech — dostają wartości domyślne */
function withNewTraitDefaults(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value
  const c = value as Partial<XpConfig>
  return {
    bulletPercent: 20,
    shieldMs: 1500,
    ...c,
    costs: { bullet: 8000, shield: 12000, ...c.costs },
  }
}
export const DEFAULT_XP_CONFIG: XpConfig = (() => {
  const configured = withNewTraitDefaults(CONFIGURED_XP)
  const error = xpConfigError(configured)
  if (error) throw new Error(`config/rozgrywka.json: ${error}`)
  const config = parseXpConfig(configured)
  if (config == null) throw new Error('Nieprawidłowe ustawienia xp w config/rozgrywka.json')
  return config
})()
export function xpConfigError(value: unknown): string | null {
  value = withNewTraitDefaults(value)
  if (value == null || typeof value !== 'object') return 'xp musi być obiektem'
  const c = value as XpConfig
  const integer = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
  if (typeof c.enabled !== 'boolean') return 'xp.enabled musi być true albo false'
  for (const t of XP_TRAITS) {
    if (!integer(c.costs?.[t], XP_COST_MIN, XP_COST_MAX))
      return `xp.costs.${t} musi być liczbą całkowitą ${XP_COST_MIN}–${XP_COST_MAX}`
  }
  for (const [key, [min, max]] of Object.entries(XP_BONUS_RANGES) as [
    keyof typeof XP_BONUS_RANGES,
    readonly [number, number],
  ][]) {
    if (!integer(c[key], min, max)) return `xp.${key} musi być liczbą całkowitą ${min}–${max}`
  }
  return null
}
export function parseXpConfig(value: unknown): XpConfig | null {
  value = withNewTraitDefaults(value)
  if (xpConfigError(value) != null) return null
  const c = value as XpConfig
  return {
    enabled: c.enabled,
    costs: Object.fromEntries(XP_TRAITS.map((t) => [t, c.costs[t]])) as Record<XpTrait, number>,
    speedPercent: c.speedPercent,
    firePercent: c.firePercent,
    armorHp: c.armorHp,
    bulletPercent: c.bulletPercent,
    shieldMs: c.shieldMs,
  }
}
export const xpCost = (state: XpState, trait: XpTrait) =>
  state.config.costs[trait] * (state.levels[trait] + 1)

export function bonusesFor(config: XpConfig, levels: Record<XpTrait, number>): SessionBonuses {
  if (!config.enabled) return NO_SESSION_BONUSES
  return {
    speedMultiplier: 1 + (levels.speed * config.speedPercent) / 100,
    fireRateMultiplier: 1 + (levels.fire * config.firePercent) / 100,
    extraHp: levels.armor * config.armorHp,
    bulletSpeedMultiplier: 1 + ((levels.bullet ?? 0) * config.bulletPercent) / 100,
    extraShieldMs: (levels.shield ?? 0) * config.shieldMs,
  }
}

/** Jedna instancja na uruchomienie serwera, niezależna od pokoju i kolejnych gier. */
export class SessionXp {
  private state: XpState = {
    maxLevel: GAMEPLAY.xpMaxLevel,
    config: parseXpConfig(DEFAULT_XP_CONFIG)!,
    bank: 0,
    earned: 0,
    levels: { ...GAMEPLAY.xpStartLevels },
  }
  /**
   * Przywraca zapisany postęp profilu (pula, zdobyte XP, poziomy cech, ustawienia).
   * Nieznane albo złe pola są pomijane — zostaje to, co było.
   */
  restore(saved: unknown): void {
    if (saved == null || typeof saved !== 'object') return
    const s = saved as Partial<XpState>
    const count = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
    const config = parseXpConfig(s.config)
    if (config != null) this.state.config = config
    this.state.bank = count(s.bank) ?? this.state.bank
    this.state.earned = count(s.earned) ?? this.state.earned
    for (const trait of XP_TRAITS) {
      const level = count(s.levels?.[trait])
      if (level != null) this.state.levels[trait] = Math.min(level, this.state.maxLevel)
    }
  }

  snapshot(): XpState {
    return {
      ...this.state,
      config: parseXpConfig(this.state.config)!,
      levels: { ...this.state.levels },
    }
  }
  configure(raw: unknown): boolean {
    const config = parseXpConfig(raw)
    if (config == null) return false
    this.state.config = config
    return true
  }
  record(event: GameEvent): boolean {
    if (!this.state.config.enabled || event.type !== 'bot_killed') return false
    // Granat też daje XP, mimo że nie daje zwykłych punktów wyniku.
    const amount = GAMEPLAY.xpKillRewards[event.level]
    this.state.bank += amount
    this.state.earned += amount
    return true
  }
  buy(trait: unknown): boolean {
    if (!XP_TRAITS.includes(trait as XpTrait) || !this.state.config.enabled) return false
    const key = trait as XpTrait
    const cost = xpCost(this.state, key)
    if (this.state.levels[key] >= this.state.maxLevel || this.state.bank < cost) return false
    this.state.bank -= cost
    this.state.levels[key]++
    return true
  }
  bonuses(): SessionBonuses {
    const { config, levels } = this.state
    return bonusesFor(config, levels)
  }
}
