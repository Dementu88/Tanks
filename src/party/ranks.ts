import ranksConfig from '../../config/stopnie.json'

/**
 * Stopnie graczy (wojsko polskie) liczone z XP gracza. Progi i wygląd odznak: config/stopnie.json.
 * Moduł bez Reacta — użyje go też serwer, gdy stopnie trafią do gry.
 */

export interface RankDef {
  nazwa: string
  /** XP potrzebne do tego stopnia */
  xp: number
  belki: number
  galony: number
  gwiazdki: number
  wezyk: boolean
}

const num = (v: unknown, min = 0) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : 0

export const RANKS: RankDef[] = ((ranksConfig as { stopnie?: Partial<RankDef>[] }).stopnie ?? [])
  .map((r) => ({
    nazwa: String(r.nazwa ?? '?'),
    xp: num(r.xp),
    belki: Math.min(4, num(r.belki)),
    galony: Math.min(4, num(r.galony)),
    gwiazdki: Math.min(4, num(r.gwiazdki)),
    wezyk: r.wezyk === true,
  }))
  .sort((a, b) => a.xp - b.xp)

if (RANKS.length === 0)
  RANKS.push({ nazwa: 'Szeregowy', xp: 0, belki: 0, galony: 0, gwiazdki: 0, wezyk: false })
// pierwszy stopień zawsze od zera
RANKS[0].xp = 0

export const LEVEL_UP_MS = Math.max(
  1000,
  num((ranksConfig as { powiadomienieMs?: unknown }).powiadomienieMs) || 4000,
)

export interface RankProgress {
  /** indeks stopnia (0 = pierwszy) */
  index: number
  rank: RankDef
  next: RankDef | null
  /** XP zdobyte w obecnym stopniu i potrzebne do następnego */
  have: number
  need: number
  /** 0–1, ile brakuje do następnego (1 = najwyższy stopień) */
  progress: number
}

export function rankIndex(xp: number): number {
  let i = 0
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++
  return i
}

export function rankProgress(xp: number): RankProgress {
  const index = rankIndex(Math.max(0, xp))
  const rank = RANKS[index]
  const next = RANKS[index + 1] ?? null
  if (next == null) return { index, rank, next, have: 0, need: 0, progress: 1 }
  const have = Math.max(0, xp - rank.xp)
  const need = next.xp - rank.xp
  return { index, rank, next, have, need, progress: need > 0 ? Math.min(1, have / need) : 1 }
}

/** awans między dwoma stanami XP: nowy stopień albo null */
export function promotion(before: number, after: number): RankDef | null {
  const a = rankIndex(before)
  const b = rankIndex(after)
  return b > a ? RANKS[b] : null
}
