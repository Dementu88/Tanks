import { describe, expect, it } from 'vitest'
import GameSession from '../src/engine/GameSession'
import { STEP_MS } from '../src/engine/Game'
import { seededRandom } from '../src/engine/random'
import InputManager from '../src/input/InputManager'
import { SceneEncoder, SceneMirror } from '../src/lan/frame'
import { stages } from '../src/stages'
import { GAMEPLAY } from '../src/engine/gameplayConfig'
import { P1, killAllBots, makeStage, runUntilPlaying, runUntilSpawned } from './helpers'

function session(
  stage = stages[0],
  options: { hiddenStarChance?: number; stageEndExtraMs?: number } = {},
) {
  const s = new GameSession(
    [stage],
    0,
    [P1],
    { play: () => {} },
    {
      autopilot: false,
      random: seededRandom(5),
      ...options,
    },
  )
  const input = new InputManager()
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += STEP_MS) {
      s.step(STEP_MS, input)
      input.endTick()
    }
  }
  return { s, run }
}

describe('ukryta gwiazdka w cegłach', () => {
  it('config: zawsze jedna na planszy, koniec mapy +5 s', () => {
    expect(GAMEPLAY.hiddenStarChance).toBe(1)
    expect(GAMEPLAY.stageEndExtraMs).toBe(5000)
  })

  it('leży w bloku pełnym cegieł, z dala od orła; bez opcji jej nie ma', () => {
    const { s, run } = session(stages[0], { hiddenStarChance: 1 })
    runUntilPlaying(s, run)
    const scene = s.scene!
    const star = scene.powerUps.find((p) => p.hidden)!
    expect(star.name).toBe('star')
    const covered = scene.map.brickIndicesIn({
      x: star.x + 4,
      y: star.y + 4,
      width: 7.99,
      height: 7.99,
    })
    expect(covered).toHaveLength(4)
    const eagle = scene.map.eagle!
    expect(Math.abs(star.x - eagle.x) > 32 || Math.abs(star.y - eagle.y) > 32).toBe(true)

    const plain = session(stages[0])
    runUntilPlaying(plain.s, plain.run)
    expect(plain.s.scene!.powerUps.some((p) => p.hidden)).toBe(false)
  })

  it('nie miga, nie znika przy nowym bonusie i trafia na TV jako ukryta', () => {
    const { s, run } = session(stages[0], { hiddenStarChance: 1 })
    runUntilPlaying(s, run)
    run(2000)
    const scene = s.scene!
    const star = scene.powerUps.find((p) => p.hidden)!
    expect(star.visible).toBe(true)
    const mirror = new SceneMirror()
    mirror.apply(new SceneEncoder().encode(scene)!)
    expect(mirror.powerUps.find((p) => p.id === star.id)?.hidden).toBe(true)
  })

  it('po rozstrzelaniu muru czołg ją zbiera i rośnie mu poziom', () => {
    // plansza: jedyny blok cegieł z dala od orła (kol. 4, wiersz 7)
    const stage = makeStage('gwiazdka', ['20*basic'], { '7,4': 'Bf' })
    const { s, run } = session(stage, { hiddenStarChance: 1 })
    runUntilPlaying(s, run)
    runUntilSpawned(s, run)
    const scene = s.scene!
    scene.devSetBotsEnabled(false)
    const star = scene.powerUps.find((p) => p.hidden)!
    expect(star).toMatchObject({ x: 64, y: 112 })
    const tank = scene.tanks.find((t) => t.side === 'player')!
    const rank = tank.rank
    scene.map.removeBricks(scene.map.brickIndicesIn({ x: 64, y: 112, width: 15.99, height: 15.99 }))
    tank.x = tank.rx = 64
    tank.y = tank.ry = 128
    run(STEP_MS)
    tank.y = tank.ry = 113
    run(STEP_MS * 2)
    expect(scene.powerUps.some((p) => p.id === star.id)).toBe(false)
    expect(tank.rank).toBe(rank + 1)
  })
})

describe('dłuższy koniec planszy', () => {
  it('po zabiciu ostatniego wroga plansza trwa o stageEndExtraMs dłużej', () => {
    const ends = (extra: number) => {
      const { s, run } = session(makeStage('koniec', ['1*basic']), { stageEndExtraMs: extra })
      runUntilPlaying(s, run)
      runUntilSpawned(s, run)
      run(4000)
      killAllBots(s)
      let t = 0
      while (s.phase === 'playing' && t < 20000) {
        run(STEP_MS)
        t += STEP_MS
      }
      return t
    }
    const base = ends(0)
    const longer = ends(5000)
    expect(longer - base).toBeGreaterThanOrEqual(4950)
    expect(longer - base).toBeLessThanOrEqual(5050)
  })
})
