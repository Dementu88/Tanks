import {
  BLOCK_SIZE as B,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  TANK_KILL_SCORE_MAP,
  TANK_LEVELS,
  ZOOM_LEVEL,
} from '../engine/constants'
import type { StatisticsView } from '../engine/StatisticsAnimation'
import type { TankLevel } from '../engine/types'
import PixelText from './pixel/PixelText'
import TankSvg from './pixel/TankSvg'
import { useUIStore } from './store'

/** 各等级所在行的 y（旧版 StatisticsScene） */
const ROW_Y: Record<TankLevel, number> = { basic: 8, fast: 9.5, power: 11, armor: 12.5 }

/** 关卡结算页，覆盖在战场画布之上 */
export default function StatisticsScene({
  view,
  scores,
}: {
  view: StatisticsView
  scores: number[]
}) {
  const hiScore = useUIStore((s) => s.hiScore)
  return (
    <svg
      width={SCREEN_WIDTH * ZOOM_LEVEL}
      height={SCREEN_HEIGHT * ZOOM_LEVEL}
      viewBox={`0 0 ${SCREEN_WIDTH} ${SCREEN_HEIGHT}`}
      style={{ position: 'absolute', top: 0, left: 0, imageRendering: 'pixelated' }}
    >
      <StatisticsContent view={view} scores={scores} hiScore={hiScore} />
    </svg>
  )
}

/** 结算页内容；画廊的 statistics 页复用 */
export function StatisticsContent({
  view,
  scores,
  hiScore,
}: {
  view: StatisticsView
  scores: number[]
  hiScore: number
}) {
  const hiScoreText = String(hiScore)
  if (view.counts.length > 2) {
    return <StatisticsManyPlayers view={view} scores={scores} hiScore={hiScoreText} />
  }
  const [p1, p2] = view.counts
  return (
    <g className="statistics-scene">
      <rect fill="#000000" width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />
      <g transform={`translate(${-0.5 * B}, ${-1.5 * B})`}>
        <PixelText content="HI-SCORE" x={4.5 * B} y={3.5 * B} fill="#e44437" />
        <PixelText
          content={hiScoreText}
          x={12.5 * B - hiScoreText.length * 0.5 * B}
          y={3.5 * B}
          fill="#feac4e"
        />
        <PixelText content={`STAGE  ${view.stageName}`} x={6.5 * B} y={4.5 * B} fill="#ffffff" />

        {/* 中间的 4 辆坦克 & 白线 */}
        {TANK_LEVELS.map((level) => (
          <TankSvg
            key={level}
            x={8 * B}
            y={(ROW_Y[level] - 0.3) * B}
            side="bot"
            level={level}
            color="silver"
          />
        ))}
        <rect x={6.5 * B} y={13.3 * B} width={4 * B} height={2} fill="white" />

        <PixelText
          content={playerTitle('Ⅰ', view.autopilot[0])}
          x={2 * B}
          y={5.5 * B}
          fill="#e44437"
        />
        <PixelText content={String(scores[0]).padStart(8)} x={2 * B} y={6.5 * B} fill="#feac4e" />
        {TANK_LEVELS.map((level) => {
          const n = p1[level]
          const count = n === -1 ? '  ' : String(n).padStart(2)
          const points = n === -1 ? '    ' : String(n * TANK_KILL_SCORE_MAP[level]).padStart(4)
          return (
            <PixelText
              key={level}
              content={`${points} PTS ${count}←`}
              x={2 * B}
              y={ROW_Y[level] * B}
              fill="white"
            />
          )
        })}
        <PixelText
          content={`TOTAL ${view.showTotal ? String(total(p1)).padStart(2) : '  '}`}
          x={3.5 * B}
          y={13.75 * B}
          fill="white"
        />

        {p2 != null && (
          <g>
            <PixelText
              content={playerTitle('Ⅱ', view.autopilot[1])}
              x={11.5 * B}
              y={5.5 * B}
              fill="#e44437"
            />
            <PixelText content={String(scores[1])} x={11.5 * B} y={6.5 * B} fill="#feac4e" />
            {TANK_LEVELS.map((level) => {
              const n = p2[level]
              const count = n === -1 ? '  ' : String(n).padEnd(2)
              const points = n === -1 ? '    ' : String(n * TANK_KILL_SCORE_MAP[level]).padEnd(4)
              return (
                <PixelText
                  key={level}
                  content={`→ ${count} PTS ${points}`}
                  x={9 * B}
                  y={ROW_Y[level] * B}
                  fill="white"
                />
              )
            })}
            <PixelText
              content={`${view.showTotal ? String(total(p2)).padEnd(2) : '  '} TOTAL`}
              x={10 * B}
              y={13.75 * B}
              fill="white"
            />
          </g>
        )}
      </g>
    </g>
  )
}

/** 托管打完的玩家标成 CPU；Ⅱ-PLAYER 已经排到屏幕右边缘，只能替换不能追加 */
function playerTitle(numeral: string, autopilot: boolean): string {
  return `${numeral}-${autopilot ? 'CPU' : 'PLAYER'}`
}

const PLAYER_FILL = ['#feac4e', '#4ade80', '#5aa9ff', '#d77bff']

/** 3–4 graczy: zwarta tabela — wiersz na gracza, kolumny na typy wrogów */
function StatisticsManyPlayers({
  view,
  scores,
  hiScore,
}: {
  view: StatisticsView
  scores: number[]
  hiScore: string
}) {
  const COLS = [7, 8.5, 10, 11.5]
  return (
    <g className="statistics-scene">
      <rect fill="#000000" width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />
      <PixelText content="HI-SCORE" x={2 * B} y={1.5 * B} fill="#e44437" />
      <PixelText
        content={hiScore}
        x={11 * B - hiScore.length * 0.5 * B}
        y={1.5 * B}
        fill="#feac4e"
      />
      <PixelText content={`STAGE  ${view.stageName}`} x={5 * B} y={3 * B} fill="#ffffff" />
      {TANK_LEVELS.map((level, j) => (
        <TankSvg key={level} x={COLS[j] * B} y={4.6 * B} side="bot" level={level} color="silver" />
      ))}
      <PixelText content="SUMA" x={13 * B} y={5 * B} fill="#ffffff" />
      {view.counts.map((counts, i) => {
        const y = (7 + i * 1.8) * B
        const cell = (v: number) => (v < 0 ? '' : String(v))
        return (
          <g key={i}>
            <PixelText
              content={view.autopilot[i] ? `${i + 1}CPU` : `${i + 1}P`}
              x={0.5 * B}
              y={y}
              fill={PLAYER_FILL[i] ?? '#ffffff'}
            />
            <PixelText
              content={String(scores[i] ?? 0).padStart(6)}
              x={2.5 * B}
              y={y}
              fill="#feac4e"
            />
            {TANK_LEVELS.map((level, j) => (
              <PixelText
                key={level}
                content={cell(counts[level]).padStart(2)}
                x={(COLS[j] + 0.1) * B}
                y={y}
                fill="#ffffff"
              />
            ))}
            <PixelText
              content={view.showTotal ? String(total(counts)).padStart(3) : ''}
              x={13 * B}
              y={y}
              fill="#ffffff"
            />
          </g>
        )
      })}
    </g>
  )
}

function total(counts: Record<TankLevel, number>): number {
  return TANK_LEVELS.reduce((sum, level) => sum + counts[level], 0)
}
