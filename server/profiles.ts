import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import profileConfig from '../config/profile.json'
import { SessionXp, type XpState } from '../src/engine/sessionXp'

/**
 * Profile drużyny (np. „TankMonsters”). Każdy ma własne XP z bonusami i rekord — najdalszą
 * planszę osobno dla plansz z gry, losowych i szerokich. Postęp zapisuje się sam do pliku
 * i wczytuje po wyborze profilu.
 */

export type RecordMode = 'classic' | 'random' | 'wide'

export interface ProfileRecord {
  /** najdalej osiągnięta plansza (indeks od 0) w każdym trybie */
  classic: number
  random: number
  wide: number
}

export interface SavedProfile {
  xp: XpState
  record: ProfileRecord
  updatedAt: string
}

export interface ProfileFile {
  version: 1
  profiles: Record<string, SavedProfile>
}

/** gdzie leży postęp; brak = tylko w pamięci (testy) */
export interface ProfileStore {
  load(): Promise<ProfileFile | null>
  save(data: ProfileFile): Promise<void>
}

const EMPTY_RECORD: ProfileRecord = { classic: 0, random: 0, wide: 0 }
export const NAME_PATTERN = /^[\p{L}\p{N} _-]{1,24}$/u

/** nazwy z config/profile.json (wbudowane przy budowaniu); pierwsza jest domyślna */
export function configuredProfiles(): string[] {
  const list = (profileConfig as { profile?: unknown }).profile
  const names = Array.isArray(list)
    ? list.map((n) => String(n).trim()).filter((n) => NAME_PATTERN.test(n))
    : []
  return names.length > 0 ? [...new Set(names)] : ['TankMonsters']
}

/** plik JSON zapisywany atomowo (najpierw .tmp, potem podmiana) */
export function fileStore(path: string): ProfileStore {
  return {
    async load() {
      try {
        const data = JSON.parse(await readFile(path, 'utf8')) as ProfileFile
        return data?.version === 1 && typeof data.profiles === 'object' ? data : null
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

interface Entry {
  xp: SessionXp
  record: ProfileRecord
}

/** profile w pamięci serwera + automatyczny zapis (z opóźnieniem, żeby nie pisać co zestrzelenie) */
export class Profiles {
  readonly names: string[]
  private readonly entries = new Map<string, Entry>()
  private index = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> = Promise.resolve()
  /** obietnica pierwszego wczytania — serwer czeka na nią przed pierwszym pokojem */
  readonly ready: Promise<void>

  constructor(
    names: string[] = configuredProfiles(),
    private readonly store: ProfileStore | null = null,
    private readonly saveDelayMs = 1500,
  ) {
    this.names = [...names]
    for (const name of this.names) this.entries.set(name, this.fresh())
    this.ready = this.loadAll()
  }

  private fresh(): Entry {
    return { xp: new SessionXp(), record: { ...EMPTY_RECORD } }
  }

  private async loadAll(): Promise<void> {
    const data = await this.store?.load().catch(() => null)
    if (data == null) return
    for (const [name, saved] of Object.entries(data.profiles)) {
      if (!NAME_PATTERN.test(name)) continue
      if (!this.entries.has(name)) {
        // profil z pliku, którego nie ma już w konfiguracji — zostaje, żeby nie zgubić postępu
        this.names.push(name)
        this.entries.set(name, this.fresh())
      }
      const entry = this.entries.get(name)!
      entry.xp.restore(saved?.xp)
      for (const mode of ['classic', 'random', 'wide'] as const) {
        const v = saved?.record?.[mode]
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0) entry.record[mode] = v
      }
    }
  }

  get current(): string {
    return this.names[this.index]
  }

  get xp(): SessionXp {
    return this.entries.get(this.current)!.xp
  }

  get record(): ProfileRecord {
    return { ...this.entries.get(this.current)!.record }
  }

  /** poprzedni / następny profil (w kółko) */
  step(delta: number): string {
    const n = this.names.length
    this.index = (((this.index + Math.sign(delta)) % n) + n) % n
    this.changed()
    return this.current
  }

  /** nowa najdalsza plansza w danym trybie; true = rekord się zmienił */
  reached(mode: RecordMode, stageIndex: number): boolean {
    const record = this.entries.get(this.current)!.record
    if (stageIndex <= record[mode]) return false
    record[mode] = stageIndex
    this.changed()
    return true
  }

  /** coś się zmieniło (XP, bonusy, rekord) — zapis za chwilę */
  changed(): void {
    if (this.store == null) return
    if (this.timer != null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.saveDelayMs)
  }

  /** zapis od razu (np. przy zamykaniu serwera) */
  flush(): Promise<void> {
    if (this.store == null) return Promise.resolve()
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const data: ProfileFile = { version: 1, profiles: {} }
    const now = new Date().toISOString()
    for (const name of this.names) {
      const entry = this.entries.get(name)!
      data.profiles[name] = { xp: entry.xp.snapshot(), record: { ...entry.record }, updatedAt: now }
    }
    const store = this.store
    this.saving = this.saving.then(() =>
      store.save(data).catch((err) => console.error('[profile] zapis nieudany:', err)),
    )
    return this.saving
  }

  dispose(): void {
    if (this.timer != null) clearTimeout(this.timer)
    this.timer = null
  }
}
