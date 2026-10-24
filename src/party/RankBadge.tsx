import { useEffect, useState, type ReactNode } from 'react'
import { usePartyStore } from './client'
import { ProfileLogo } from './PlayerProfile'
import { LEVEL_UP_MS, RANKS, rankProgress, type RankDef } from './ranks'

/**
 * Dwa kółka profilu gracza: logo i odznaka stopnia z pierścieniem postępu do następnego stopnia.
 * Odznaki rysowane wektorowo z config/stopnie.json (gwiazdki, galony, belki, wężyk).
 */

function star(cx: number, cy: number, r: number): string {
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 === 0 ? r : r * 0.42
    points.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`)
  }
  return points.join(' ')
}

/** sama odznaka w polu 100 × 100 */
export function Insignia({ rank }: { rank: RankDef }) {
  const parts: ReactNode[] = []
  // układ od góry: gwiazdki, galony, belki, wężyk — całość wyśrodkowana w pionie
  const rows: { h: number; draw: (y: number) => ReactNode }[] = []
  if (rank.gwiazdki > 0) {
    const n = rank.gwiazdki
    const twoRows = n > 2
    const perRow = twoRows ? Math.ceil(n / 2) : n
    const r = 9
    const rowCount = twoRows ? 2 : 1
    rows.push({
      h: rowCount * 20,
      draw: (y) =>
        Array.from({ length: n }, (_, i) => {
          const row = twoRows ? Math.floor(i / perRow) : 0
          const inRow = twoRows ? (row === 0 ? perRow : n - perRow) : n
          const col = twoRows ? i % perRow : i
          const cx = 50 + (col - (inRow - 1) / 2) * 22
          return <polygon key={`s${i}`} points={star(cx, y + 10 + row * 20, r)} />
        }),
    })
  }
  for (let i = 0; i < rank.galony; i++) {
    rows.push({
      h: 11,
      draw: (y) => <rect key={`g${i}`} x={22} y={y + 1} width={56} height={8} rx={1} />,
    })
  }
  for (let i = 0; i < rank.belki; i++) {
    rows.push({
      h: 8,
      draw: (y) => <rect key={`b${i}`} x={28} y={y + 2} width={44} height={4} rx={1} />,
    })
  }
  if (rank.wezyk) {
    rows.push({
      h: 14,
      draw: (y) => (
        <polyline
          key="w"
          points={Array.from(
            { length: 9 },
            (_, i) => `${18 + i * 8},${y + (i % 2 === 0 ? 11 : 3)}`,
          ).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={3.5}
          strokeLinejoin="round"
        />
      ),
    })
  }
  if (rows.length === 0) {
    // szeregowy: pusta pagona — sam znak
    parts.push(<rect key="p" x={38} y={46} width={24} height={8} rx={2} fillOpacity={0.35} />)
  } else {
    const gap = 3
    const total = rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1)
    let y = 50 - total / 2
    for (const row of rows) {
      parts.push(row.draw(y))
      y += row.h + gap
    }
  }
  return <g fill="currentColor">{parts}</g>
}

/** kółko z odznaką stopnia i pierścieniem: ile zostało do następnego */
export function RankCircle({ xp, size = 56 }: { xp: number; size?: number }) {
  const p = rankProgress(xp)
  const r = 46
  const length = 2 * Math.PI * r
  return (
    <svg
      className="rank-circle"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={`${p.rank.nazwa}, ${Math.round(p.progress * 100)}% do następnego stopnia`}
    >
      <circle cx={50} cy={50} r={r} className="rank-track" />
      <circle
        cx={50}
        cy={50}
        r={r}
        className="rank-progress"
        strokeDasharray={`${length * p.progress} ${length}`}
        transform="rotate(-90 50 50)"
      />
      <g transform="translate(50 50) scale(0.62) translate(-50 -50)">
        <Insignia rank={p.rank} />
      </g>
    </svg>
  )
}

/** kółko z logo gracza (ten sam rozmiar co odznaka) */
export function LogoCircle({
  logo,
  size = 56,
}: {
  logo: string | null | undefined
  size?: number
}) {
  return (
    <span className="logo-circle" style={{ width: size, height: size }}>
      <ProfileLogo id={logo} size={Math.round(size * 0.58)} />
    </span>
  )
}

/** profil gracza: dwa kółka, tytuł i ile brakuje */
export function PlayerCard({ name, logo, xp }: { name: string; logo: string; xp: number }) {
  const p = rankProgress(xp)
  return (
    <div className="player-card">
      <LogoCircle logo={logo} />
      <RankCircle xp={xp} />
      <div className="player-card-text">
        <strong>{name}</strong>
        <span className="player-card-rank">{p.rank.nazwa}</span>
        <small>
          {p.next == null
            ? `XP ${xp} · najwyższy stopień`
            : `XP ${xp} · do stopnia ${p.next.nazwa}: ${p.need - p.have}`}
        </small>
      </div>
    </div>
  )
}

/** powiadomienie o awansie (kilka sekund) */
export function LevelUpToast({ name, logo, rank }: { name: string; logo: string; rank: RankDef }) {
  return (
    <div className="levelup-toast" role="status">
      <LogoCircle logo={logo} size={44} />
      <svg viewBox="0 0 100 100" width={44} height={44} className="rank-circle" aria-hidden="true">
        <circle cx={50} cy={50} r={46} className="rank-progress" />
        <g transform="translate(50 50) scale(0.62) translate(-50 -50)">
          <Insignia rank={rank} />
        </g>
      </svg>
      <div>
        <small>AWANS</small>
        <strong>
          {name} → {rank.nazwa}
        </strong>
      </div>
    </div>
  )
}

/**
 * Powiadomienie o awansie z serwera — pokazuje się na kilka sekund u wszystkich
 * (TV i pady). Wstawiane raz na ekran.
 */
export function PromotionToast() {
  const promotion = usePartyStore((s) => s.promotion)
  const [shown, setShown] = useState<typeof promotion>(null)
  useEffect(() => {
    if (promotion == null) return
    setShown(promotion)
    const id = window.setTimeout(() => setShown(null), LEVEL_UP_MS)
    return () => window.clearTimeout(id)
  }, [promotion])
  if (shown == null) return null
  const rank = RANKS[shown.rank]
  if (rank == null) return null
  return (
    <div
      className="promotion-layer"
      key={shown.key}
      style={{ ['--toast-ms' as string]: `${LEVEL_UP_MS}ms` }}
    >
      <LevelUpToast name={shown.name} logo={shown.logo} rank={rank} />
    </div>
  )
}
