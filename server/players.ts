import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import playersConfig from '../config/gracze.json'
import logosConfig from '../config/loga.json'
import type { GameEvent } from '../src/engine/events'
import type { TankLevel } from '../src/engine/types'

/**
 * Profile graczy: lekkie liczniki statystyk (zabici wrogowie, rundy, gry, strzały…) zapisywane
 * z opóźnieniem do pliku. Zdarzenia gry tylko zwiększają liczby w pamięci — serwer nie pisze
 * na dysk przy każdym strzale. Pola `level` / `xp` czekają na przyszłe poziomy postaci.
 */

export interface PlayerDef {
  id: string
  name: string
  logo: string
}

export interface PlayerStats {
  games: number
  stagesPlayed: number
  stagesCleared: number
  /** najdalsza plansza (numer od 1) */
  bestStage: number
  kills: Record<TankLevel, number>
  grenadeKills: number
  shots: number
  hits: number
  deaths: number
  powerups: number
  livesGained: number
  teammateHits: number
  /** suma punktów z ukończonych plansz */
  score: number
  playTimeMs: number
  /** przyszłe poziomy postaci */
  level: number
  xp: number
  /** logo wybrane w grze (ma pierwszeństwo przed configiem) */
  logo?: string
}

export interface PlayersFile {
  version: 1
  players: Record<string, PlayerStats & { updatedAt?: string }>
}

export interface PlayersStore {
  load(): Promise<PlayersFile | null>
  save(data: PlayersFile): Promise<void>
}

export const LOGO_IDS: string[] = (logosConfig as { loga: { id: string }[] }).loga.map((l) => l.id)

export const emptyStats = (): PlayerStats => ({
  games: 0,
  stagesPlayed: 0,
  stagesCleared: 0,
  bestStage: 0,
  kills: { basic: 0, fast: 0, power: 0, armor: 0 },
  grenadeKills: 0,
  shots: 0,
  hits: 0,
  deaths: 0,
  powerups: 0,
  livesGained: 0,
  teammateHits: 0,
  score: 0,
  playTimeMs: 0,
  level: 0,
  xp: 0,
})

const ID_PATTERN = /^[a-z0-9_-]{1,24}$/

/** gracze z config/gracze.json (wbudowane przy budowaniu) */
export function configuredPlayers(): PlayerDef[] {
  const list = (playersConfig as { gracze?: { id?: unknown; nazwa?: unknown; logo?: unknown }[] })
    .gracze
  const seen = new Set<string>()
  const out: PlayerDef[] = []
  for (const p of Array.isArray(list) ? list : []) {
    const id = String(p?.id ?? '').trim()
    if (!ID_PATTERN.test(id) || seen.has(id)) continue
    seen.add(id)
    const logo = String(p?.logo ?? '')
    out.push({
      id,
      name: String(p?.nazwa ?? id).slice(0, 24),
      logo: LOGO_IDS.includes(logo) ? logo : (LOGO_IDS[0] ?? ''),
    })
  }
  return out
}

export function playersFileStore(path: string): PlayersStore {
  return {
    async load() {
      try {
        const data = JSON.parse(await readFile(path, 'utf8')) as PlayersFile
        return data?.version === 1 && typeof data.players === 'object' ? data : null
      } catch {
        return null
      }
    },
    async save(data) {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      await writeFile(tmp, JSON.stringify(data, null, 2))
      await rename(tmp, path)
    },
  }
}

const count = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0

export class PlayerBook {
  readonly defs: PlayerDef[]
  private readonly stats = new Map<string, PlayerStats>()
  /** kiedy zaczęła się trwająca gra danego gracza (do czasu gry) */
  private readonly playingSince = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> = Promise.resolve()
  readonly ready: Promise<void>

  constructor(
    defs: PlayerDef[] = configuredPlayers(),
    private readonly store: PlayersStore | null = null,
    private readonly saveDelayMs = 3000,
  ) {
    this.defs = defs
    for (const d of defs) this.stats.set(d.id, emptyStats())
    this.ready = this.loadAll()
  }

  private async loadAll(): Promise<void> {
    const data = await this.store?.load().catch(() => null)
    if (data == null) return
    for (const [id, saved] of Object.entries(data.players)) {
      // statystyki usuniętego z configu gracza zostają w pliku, ale nie są pokazywane
      const s = this.stats.get(id)
      if (s == null || saved == null) continue
      for (const key of Object.keys(s) as (keyof PlayerStats)[]) {
        if (key === 'kills') {
          for (const level of Object.keys(s.kills) as TankLevel[])
            s.kills[level] = count(saved.kills?.[level])
        } else if (key !== 'logo') {
          ;(s as unknown as Record<string, number>)[key] = count(saved[key])
        }
      }
      if (typeof saved.logo === 'string' && LOGO_IDS.includes(saved.logo)) s.logo = saved.logo
    }
    this.retained = data.players
  }

  /** wpisy z pliku, których nie ma w configu — zapisujemy je dalej, żeby nic nie przepadło */
  private retained: PlayersFile['players'] = {}

  has(id: string | null | undefined): id is string {
    return id != null && this.stats.has(id)
  }

  def(id: string): PlayerDef | undefined {
    return this.defs.find((d) => d.id === id)
  }

  logoOf(id: string): string {
    return this.stats.get(id)?.logo ?? this.def(id)?.logo ?? ''
  }

  setLogo(id: string, logo: string): boolean {
    const s = this.stats.get(id)
    if (s == null || !LOGO_IDS.includes(logo)) return false
    s.logo = logo
    this.changed()
    return true
  }

  statsOf(id: string): PlayerStats | undefined {
    const s = this.stats.get(id)
    return s == null ? undefined : { ...s, kills: { ...s.kills } }
  }

  /** zaczyna się gra z tymi graczami */
  gameStarted(ids: string[], now = Date.now()): void {
    for (const id of ids) {
      const s = this.stats.get(id)
      if (s == null) continue
      s.games += 1
      this.playingSince.set(id, now)
    }
    this.changed()
  }

  /** gra się skończyła (albo przerwana) — doliczamy czas */
  gameEnded(now = Date.now()): void {
    for (const [id, since] of this.playingSince) {
      const s = this.stats.get(id)
      if (s != null) s.playTimeMs += Math.max(0, now - since)
    }
    this.playingSince.clear()
    this.changed()
  }

  /** zdarzenie z gry; liczy tylko graczy z profilem */
  record(event: GameEvent): void {
    const bump = (id: string | null | undefined, f: (s: PlayerStats) => void) => {
      const s = id == null ? undefined : this.stats.get(id)
      if (s == null) return
      f(s)
      this.changed()
    }
    switch (event.type) {
      case 'stage_started':
        for (const id of event.playerIds) {
          bump(id, (s) => {
            s.stagesPlayed += 1
            s.bestStage = Math.max(s.bestStage, event.stageNumber)
          })
        }
        return
      case 'stage_cleared':
        for (const p of event.players) {
          bump(p.playerId, (s) => {
            s.stagesCleared += 1
            s.score += p.score
          })
        }
        return
      case 'bot_killed':
        bump(event.playerId, (s) => {
          s.kills[event.level] += 1
          if (event.by === 'grenade') s.grenadeKills += 1
        })
        return
      case 'shot':
        bump(event.playerId, (s) => (s.shots += 1))
        return
      case 'bot_hit':
        bump(event.playerId, (s) => (s.hits += 1))
        return
      case 'player_died':
        bump(event.playerId, (s) => (s.deaths += 1))
        return
      case 'powerup_picked':
        bump(event.playerId, (s) => (s.powerups += 1))
        return
      case 'life_gained':
        bump(event.playerId, (s) => (s.livesGained += 1))
        return
      case 'teammate_hit':
        bump(event.playerId, (s) => (s.teammateHits += 1))
        return
      default:
        return
    }
  }

  changed(): void {
    if (this.store == null) return
    if (this.timer != null) return // zapis i tak za chwilę — nie przesuwamy go przy każdym strzale
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.saveDelayMs)
  }

  flush(): Promise<void> {
    if (this.store == null) return Promise.resolve()
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const now = new Date().toISOString()
    const data: PlayersFile = { version: 1, players: { ...this.retained } }
    for (const [id, s] of this.stats)
      data.players[id] = { ...s, kills: { ...s.kills }, updatedAt: now }
    const store = this.store
    this.saving = this.saving.then(() =>
      store.save(data).catch((err) => console.error('[gracze] zapis nieudany:', err)),
    )
    return this.saving
  }

  dispose(): void {
    if (this.timer != null) clearTimeout(this.timer)
    this.timer = null
  }
}
