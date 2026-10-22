import { describe, expect, it } from 'vitest'
import { parseStage } from '../src/engine/map/parseStage'
import { mirrorToken, randomCampaign, randomStage } from '../src/engine/map/randomStage'
import { seededRandom } from '../src/engine/random'
import { runUntilPlaying, runUntilSpawned, setup } from './helpers'

describe('losowe plansze', () => {
  it('są poprawne dla parsera: orzeł, 13 wierszy po 13 pól, 20 wrogów', () => {
    const random = seededRandom(42)
    for (let i = 1; i <= 50; i += 1) {
      const stage = randomStage(`R${i}`, i, random)
      expect(stage.map).toHaveLength(13)
      for (const row of stage.map) expect(row.trim().split(/ +/)).toHaveLength(13)
      const parsed = parseStage(stage)
      expect(parsed.eagle).toEqual({ x: 6 * 16, y: 12 * 16 })
      const bots = parsed.bots.reduce((s, g) => s + g.count, 0)
      expect(bots).toBe(20)
    }
  })

  it('miejsca startu są puste, a plansza symetryczna', () => {
    const stage = randomStage('R1', 5, seededRandom(7))
    const grid = stage.map.map((r) => r.trim().split(/ +/))
    for (const [r, c] of [
      [0, 0],
      [0, 6],
      [0, 12],
      [12, 2],
      [12, 4],
      [12, 8],
      [12, 10],
    ]) {
      expect(grid[r][c]).toBe('X')
    }
    for (let r = 0; r < 13; r += 1) {
      for (let c = 0; c < 6; c += 1) {
        if (r >= 11 && c >= 5) continue // twierdza orła
        expect(grid[r][12 - c]).toBe(mirrorToken(grid[r][c]))
      }
    }
  })

  it('da się na nich grać — sesja rusza, wrogowie się pojawiają', () => {
    const { session, run } = setup(randomCampaign(3, seededRandom(3)))
    runUntilPlaying(session, run)
    runUntilSpawned(session, run)
    expect(session.stage.name).toBe('R1')
    expect(session.scene!.tanks.some((t) => t.side === 'bot')).toBe(true)
  })
})
