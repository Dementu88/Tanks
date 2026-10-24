import { useEffect, useState } from 'react'
import playersConfig from '../../config/gracze.json'
import { GAMEPLAY } from '../engine/gameplayConfig'
import { Insignia, LevelUpToast, PlayerCard } from './RankBadge'
import { LEVEL_UP_MS, promotion, RANKS, type RankDef } from './ranks'

/**
 * Poligon: podgląd stopni graczy i powiadomień o awansie, zanim trafią do gry.
 * XP jest tu tylko na próbę (zapamiętane w przeglądarce), nie zmienia statystyk z serwera.
 */

interface Player {
  id: string
  nazwa: string
  logo: string
}

const PLAYERS: Player[] = (playersConfig as { gracze: Player[] }).gracze
const STORAGE = 'party-lab-ranks-v1'

export interface LabToast {
  name: string
  logo: string
  rank: RankDef
  key: number
}

function loadXp(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
    return raw != null && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/** powiadomienie na planszy poligonu: znika samo po LEVEL_UP_MS */
export function useLabToast() {
  const [toast, setToast] = useState<LabToast | null>(null)
  useEffect(() => {
    if (toast == null) return
    const id = window.setTimeout(() => setToast(null), LEVEL_UP_MS)
    return () => window.clearTimeout(id)
  }, [toast])
  return [toast, setToast] as const
}

export function LabToastView({ toast }: { toast: LabToast | null }) {
  if (toast == null) return null
  return (
    <div
      className="lab-toast-layer"
      key={toast.key}
      style={{ ['--toast-ms' as string]: `${LEVEL_UP_MS}ms` }}
    >
      <LevelUpToast name={toast.name} logo={toast.logo} rank={toast.rank} />
    </div>
  )
}

export function LabRanksPanel({ onToast }: { onToast: (t: LabToast) => void }) {
  const [index, setIndex] = useState(0)
  const [xpBy, setXpBy] = useState(loadXp)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(xpBy))
    } catch {
      // prywatne okno
    }
  }, [xpBy])
  if (PLAYERS.length === 0) return null
  const player = PLAYERS[index % PLAYERS.length]
  const xp = xpBy[player.id] ?? 0
  const setXp = (next: number) => {
    const value = Math.max(0, Math.round(next))
    const up = promotion(xp, value)
    if (up != null) onToast({ name: player.nazwa, logo: player.logo, rank: up, key: Date.now() })
    setXpBy({ ...xpBy, [player.id]: value })
  }
  const rewards = GAMEPLAY.xpKillRewards
  const max = RANKS[RANKS.length - 1].xp + 1000
  return (
    <details className="lab-preview lab-ranks" open>
      <summary>Stopnie i awanse (podgląd)</summary>
      <p>
        Stopień liczy się z XP gracza za zniszczonych wrogów. Tu XP jest tylko na próbę — po
        akceptacji przeniesiemy stopnie i powiadomienia do gry.
      </p>
      <div className="lab-presets">
        <button
          aria-label="Poprzedni gracz"
          onClick={() => setIndex((index + PLAYERS.length - 1) % PLAYERS.length)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth="2.5" />
          </svg>
        </button>
        <button aria-pressed="true">{player.nazwa}</button>
        <button aria-label="Następny gracz" onClick={() => setIndex((index + 1) % PLAYERS.length)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M9 5 L16 12 L9 19" fill="none" stroke="currentColor" strokeWidth="2.5" />
          </svg>
        </button>
      </div>
      <PlayerCard name={player.nazwa} logo={player.logo} xp={xp} />
      <div className="lab-presets">
        <button onClick={() => setXp(xp + rewards.basic)}>+{rewards.basic} zwykły</button>
        <button onClick={() => setXp(xp + rewards.fast)}>+{rewards.fast} szybki</button>
        <button onClick={() => setXp(xp + rewards.power)}>+{rewards.power} mocny</button>
        <button onClick={() => setXp(xp + rewards.armor)}>+{rewards.armor} pancerny</button>
        <button onClick={() => setXp(xp + 1000)}>+1000</button>
        <button onClick={() => setXp(0)}>Zeruj</button>
      </div>
      <label className="lab-slider" htmlFor="lab-rank-xp">
        <span>
          XP gracza
          <output>{xp}</output>
        </span>
        <input
          id="lab-rank-xp"
          type="range"
          min={0}
          max={max}
          step={10}
          value={xp}
          onChange={(e) => setXp(Number(e.target.value))}
        />
      </label>
      <div className="rank-gallery">
        {RANKS.map((r, i) => (
          <button
            key={r.nazwa}
            className="rank-gallery-item"
            aria-pressed={xp >= r.xp && (RANKS[i + 1] == null || xp < RANKS[i + 1].xp)}
            onClick={() => setXp(r.xp)}
            title={`Ustaw XP na ${r.xp}`}
          >
            <svg viewBox="0 0 100 100" width={34} height={34} aria-hidden="true">
              <Insignia rank={r} />
            </svg>
            <span>{r.nazwa}</span>
            <small>{r.xp} XP</small>
          </button>
        ))}
      </div>
    </details>
  )
}
