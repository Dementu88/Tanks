import { afterAll, describe, expect, it } from 'vitest'
import {
  BOT_SPAWN_X,
  FIELD_BLOCK_SIZE,
  FIELD_WIDTH,
  PLAYER_COLORS,
  playerSpawns,
  SCREEN_WIDTH,
  setFieldCols,
  WIDE_FIELD_COLS,
} from '../src/engine/constants'
import type { PlayerConfig } from '../src/engine/GameSession'
import { parseStage } from '../src/engine/map/parseStage'
import { randomCampaign, randomStage } from '../src/engine/map/randomStage'
import { seededRandom } from '../src/engine/random'
import { PLAYER1_CONTROL } from '../src/input/bindings'
import { SceneEncoder, SceneMirror } from '../src/lan/frame'
import { runUntilPlaying, runUntilSpawned, setup } from './helpers'

const W = WIDE_FIELD_COLS

describe('szeroka plansza', () => {
  afterAll(() => setFieldCols(FIELD_BLOCK_SIZE))

  it('losowa szeroka: 13 wierszy po 21 pól, orzeł na środku, starty puste', () => {
    const random = seededRandom(3)
    for (let i = 1; i <= 30; i += 1) {
      const stage = randomStage(`W${i}`, i, random, W)
      expect(stage.map).toHaveLength(13)
      for (const row of stage.map) expect(row.trim().split(/ +/)).toHaveLength(W)
      const parsed = parseStage(stage)
      expect(parsed.eagle).toEqual({ x: 10 * 16, y: 12 * 16 })
      const grid = stage.map.map((r) => r.trim().split(/ +/))
      for (const p of playerSpawns(W)) expect(grid[12][p.x / 16]).toBe('X')
    }
    expect(FIELD_WIDTH).toBe(W * 16)
    expect(SCREEN_WIDTH).toBe(W * 16 + 48)
    expect(randomCampaign(3, seededRandom(1), W).map((s) => s.name)).toEqual(['W1', 'W2', 'W3'])
  })

  it('zwykła plansza przywraca szerokość 13', () => {
    parseStage(randomStage('R1', 1, seededRandom(1)))
    expect(FIELD_WIDTH).toBe(13 * 16)
    expect(BOT_SPAWN_X).toEqual([6 * 16, 12 * 16, 0])
    expect(playerSpawns()).toEqual([
      { x: 64, y: 192 },
      { x: 128, y: 192 },
      { x: 32, y: 192 },
      { x: 160, y: 192 },
    ])
  })

  it('4 graczy gra na szerokiej: starty, wrogowie z 5 wjazdów, TV dostaje szerokość', () => {
    const spawns = playerSpawns(W)
    const players: PlayerConfig[] = spawns.map((spawnPos, i) => ({
      control: { ...PLAYER1_CONTROL, fire: `Fire${i}` },
      color: PLAYER_COLORS[i],
      spawnPos,
    }))
    const stages = randomCampaign(2, seededRandom(11), W)
    const { session, run } = setup(stages, players)
    runUntilPlaying(session, run)
    runUntilSpawned(session, run)
    expect(BOT_SPAWN_X).toHaveLength(5)
    const scene = session.scene!
    const mine = scene.tanks.filter((t) => t.side === 'player')
    expect(mine.map((t) => t.x).sort((a, b) => a - b)).toEqual(
      spawns.map((p) => p.x).sort((a, b) => a - b),
    )
    // wrogowie jeżdżą po całej szerokości i nic się nie wysypuje
    const seenX = new Set<number>()
    for (let i = 0; i < 40; i += 1) {
      run(500)
      for (const t of session.scene?.tanks ?? []) {
        expect(t.x).toBeGreaterThanOrEqual(0)
        expect(t.x).toBeLessThanOrEqual(FIELD_WIDTH - 16)
        if (t.side === 'bot') seenX.add(Math.floor(t.x / 64))
      }
    }
    expect(Math.max(...seenX)).toBeGreaterThan(3)

    // klatka z mapą niesie szerokość; lustro po stronie TV ją ustawia
    const frame = new SceneEncoder().encode(session.scene!)!
    expect(frame.map?.cols).toBe(W)
    setFieldCols(FIELD_BLOCK_SIZE)
    const mirror = new SceneMirror()
    mirror.apply(frame)
    expect(FIELD_WIDTH).toBe(W * 16)
    expect(mirror.map!.bricks).toEqual(session.scene!.map.bricks)
  }, 60000)
})
