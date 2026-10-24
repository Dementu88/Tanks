import { useEffect, useRef } from 'react'
import logosConfig from '../../config/loga.json'
import { sendParty } from './client'
import type { PartyRoomState } from './protocol'
import { LogoCircle, RankCircle } from './RankBadge'
import { rankProgress } from './ranks'

/** Profile graczy na padzie: wybór lewo / prawo, logo i krótkie statystyki. */

interface LogoDef {
  id: string
  nazwa: string
  /** pole rysunku; brak = 0 0 24 24 */
  viewBox?: string
  svg: string
}

export const LOGOS: LogoDef[] = (logosConfig as { loga: LogoDef[] }).loga

/** wektorowe logo profilu (kształty z config/loga.json, kolor z currentColor) */
export function ProfileLogo({ id, size = 22 }: { id: string | null | undefined; size?: number }) {
  const logo = LOGOS.find((l) => l.id === id)
  if (logo == null) return null
  return (
    <svg
      className="profile-logo"
      viewBox={logo.viewBox ?? '0 0 24 24'}
      width={size}
      height={size}
      aria-label={logo.nazwa}
      role="img"
      dangerouslySetInnerHTML={{ __html: logo.svg }}
    />
  )
}

const STORAGE = 'party-player-id'

function savedPlayer(): string | null {
  try {
    return localStorage.getItem(STORAGE)
  } catch {
    return null
  }
}

function rememberPlayer(id: string | null): void {
  try {
    if (id == null) localStorage.removeItem(STORAGE)
    else localStorage.setItem(STORAGE, id)
  } catch {
    // prywatne okno
  }
}

/** telefon pamięta swój profil i wybiera go sam po dołączeniu (jeśli nikt go nie zajął) */
export function useRememberedPlayer(room: PartyRoomState | null, slot: number | null): void {
  const sent = useRef(false)
  useEffect(() => {
    if (room == null || slot == null || sent.current || room.playing) return
    const mine = room.padPlayers?.[slot] ?? null
    const wanted = savedPlayer()
    sent.current = true
    if (mine != null || wanted == null) return
    const taken = room.padPlayers?.some((p, i) => i !== slot && p === wanted)
    if (room.players?.some((p) => p.id === wanted) && !taken) sendParty({ t: 'player', id: wanted })
  }, [room, slot])
}

function Chevron({ left }: { left?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={left ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
    </svg>
  )
}

/** wiersz wyboru profilu na padzie (tylko w lobby) */
export function PlayerPicker({ room, slot }: { room: PartyRoomState; slot: number }) {
  const players = room.players ?? []
  if (players.length === 0) return null
  const mine = room.padPlayers?.[slot] ?? null
  const taken = new Set(room.padPlayers?.filter((p, i) => i !== slot && p != null) as string[])
  const options: (string | null)[] = [
    null,
    ...players.map((p) => p.id).filter((id) => !taken.has(id)),
  ]
  const step = (delta: number) => {
    const i = Math.max(0, options.indexOf(mine))
    const next = options[(i + delta + options.length) % options.length]
    rememberPlayer(next)
    sendParty({ t: 'player', id: next })
  }
  const me = players.find((p) => p.id === mine)
  const stats = room.padStats?.[slot]
  const nextLogo = () => {
    if (me == null) return
    const i = LOGOS.findIndex((l) => l.id === me.logo)
    sendParty({ t: 'player-logo', logo: LOGOS[(i + 1) % LOGOS.length].id })
  }
  return (
    <div className="pad-player-pick">
      <button
        type="button"
        className="hud-btn icon"
        aria-label="Poprzedni profil"
        onClick={() => step(-1)}
      >
        <Chevron left />
      </button>
      <button
        type="button"
        className="hud-btn pad-player-name"
        aria-label={me != null ? 'Zmień logo' : 'Gość'}
        onClick={nextLogo}
        disabled={me == null}
      >
        {me != null && (
          <>
            <LogoCircle logo={me.logo} size={30} />
            <RankCircle xp={me.xp} size={30} />
          </>
        )}
        <span className="pad-player-label">
          {me?.name.toUpperCase() ?? 'GOŚĆ'}
          {me != null && <small>{rankProgress(me.xp).rank.nazwa}</small>}
        </span>
      </button>
      <button
        type="button"
        className="hud-btn icon"
        aria-label="Następny profil"
        onClick={() => step(1)}
      >
        <Chevron />
      </button>
      {stats != null && (
        <span className="pad-player-stats">
          zabici {stats.kills} · rundy {stats.stages} · gry {stats.games}
        </span>
      )}
    </div>
  )
}
