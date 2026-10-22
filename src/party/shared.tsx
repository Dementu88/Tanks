import { useEffect } from 'react'

export const SLOT_COLORS = ['#e7ad3e', '#96d332', '#5aa9ff', '#d77bff']
export const SLOT_NAMES = ['Gracz 1', 'Gracz 2', 'Gracz 3', 'Gracz 4']

/** party ma własne, czarne tło i chowa narożnik z GitHubem */
export function useBodyClass(name: string): void {
  useEffect(() => {
    document.body.classList.add(name)
    return () => document.body.classList.remove(name)
  }, [name])
}

/** mały czołg w kolorze gracza */
export function TankIcon({ color, size = 28 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="7" y="1" width="2" height="6" fill={color} />
      <rect x="4" y="5" width="8" height="9" fill={color} />
      <rect x="1" y="3" width="3" height="12" fill={color} opacity="0.6" />
      <rect x="12" y="3" width="3" height="12" fill={color} opacity="0.6" />
      <rect x="6" y="8" width="4" height="4" fill="#000" opacity="0.35" />
    </svg>
  )
}

export function PlayerBadge({ slot }: { slot: number }) {
  return (
    <span className="party-badge" style={{ color: SLOT_COLORS[slot] }}>
      <TankIcon color={SLOT_COLORS[slot]} />
      {SLOT_NAMES[slot]}
    </span>
  )
}
