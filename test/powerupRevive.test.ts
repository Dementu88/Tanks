import { describe, expect, it } from 'vitest'
import { STEP_MS } from '../src/engine/Game'
import GameSession from '../src/engine/GameSession'
import { PLAYER_COLORS, PLAYER_SPAWNS } from '../src/engine/constants'
import type { GameEvent } from '../src/engine/events'
import type { PowerUpName } from '../src/engine/types'
import { seededRandom } from '../src/engine/random'
import InputManager from '../src/input/InputManager'
import { PLAYER1_CONTROL } from '../src/input/bindings'
import { makeStage, runUntilPlaying, runUntilSpawned } from './helpers'

function setupRevival() {
  const events: GameEvent[] = []
  const session = new GameSession(
    [makeStage('revive', ['20*basic'])],
    0,
    PLAYER_SPAWNS.map((spawnPos, i) => ({
      id: `p${i + 1}`,
      color: PLAYER_COLORS[i],
      spawnPos,
      control: { ...PLAYER1_CONTROL, fire: `Fire${i}` },
    })),
    { play: () => {} },
    { autopilot: false, random: seededRandom(1), events: { emit: (e) => events.push(e) } },
  )
  const input = new InputManager()
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += STEP_MS) {
      session.step(STEP_MS, input)
      input.endTick()
    }
  }
  runUntilPlaying(session, run)
  runUntilSpawned(session, run)
  const scene = session.scene!
  scene.devFreezeBots(true)
  scene.devSetBotsEnabled(false)
  for (const player of session.players) player.lives = 0
  events.length = 0
  return { session, scene, run, events }
}

const bonuses: PowerUpName[] = ['tank', 'star', 'grenade', 'timer', 'helmet', 'shovel']

describe('bonus wskrzesza poległych bez zapasu', () => {
  it('gwiazdka podnosi poziom wszystkich żyjących graczy, maksymalnie do LV5', () => {
    const { scene, run, session } = setupRevival()
    ;[1, 2, 4, 5].forEach((rank, index) => scene.devSetRank(index, rank))
    scene.devSpawnPowerUp(0, 'star')
    run(STEP_MS)
    expect(scene.devPlayers().map((p) => p.rank)).toEqual([2, 3, 5, 5])
    expect(session.players[3].score).toBeGreaterThan(0)
    expect(scene.tanks.filter((t) => t.side === 'bot').every((t) => t.rank === 0)).toBe(true)
  })

  it('gwiazdka nie ulepsza poległych ani czołgów w animacji odrodzenia', () => {
    const { scene, run, session } = setupRevival()
    scene.devSetRank(1, 4)
    scene.devSetRank(2, 4)
    session.players[2].lives = 1
    scene.devKillPlayer(1)
    scene.devKillPlayer(2)
    run(650)
    expect(scene.flickers.filter((f) => f.tank.side === 'player')).toHaveLength(1)
    scene.devSpawnPowerUp(0, 'star')
    run(STEP_MS)
    expect(scene.devPlayers().map((p) => p.rank)).toEqual([2, 1, 1, 2])
    run(700)
    expect(scene.devPlayers().map((p) => p.rank)).toEqual([2, 1, 1, 2])
  })
  it.each(bonuses)('%s przywraca wszystkich poległych z tarczą i bez zapasu', (bonus) => {
    const { session, scene, run, events } = setupRevival()
    for (let i = 1; i < 4; i++) scene.devKillPlayer(i)
    run(700)
    expect(scene.tanks.filter((t) => t.side === 'player')).toHaveLength(1)
    scene.devSpawnPowerUp(0, bonus)
    run(STEP_MS)
    expect(scene.flickers.filter((f) => f.tank.side === 'player')).toHaveLength(3)
    expect(session.players.slice(1).map((p) => p.lives)).toEqual([0, 0, 0])
    expect(events.filter((e) => e.type === 'life_gained' && e.playerId !== 'p1')).toHaveLength(3)
    expect(session.players[0].lives).toBe(bonus === 'tank' ? 1 : 0)
    if (bonus === 'grenade')
      expect(scene.tanks.some((t) => t.side === 'bot' && t.alive)).toBe(false)
    if (bonus === 'star') expect(scene.tanks.find((t) => t.color === 'yellow')!.rank).toBe(2)
    run(700)
    const players = scene.tanks.filter((t) => t.side === 'player')
    expect(players).toHaveLength(4)
    expect(players.filter((t) => t.color !== 'yellow').every((t) => t.helmetDuration > 0)).toBe(
      true,
    )
    expect(session.players.slice(1).map((p) => p.lives)).toEqual([0, 0, 0])
  })

  it('nie dodaje zapasu żyjącym ani nie dubluje odrodzenia po kolejnych bonusach', () => {
    const { session, scene, run, events } = setupRevival()
    scene.devKillPlayer(1)
    scene.devSpawnPowerUp(0, 'helmet')
    run(STEP_MS)
    // Gracz dostał życie do odrodzenia, ale czeka na zakończenie eksplozji.
    expect(session.players[1].lives).toBe(1)
    expect(scene.flickers.filter((f) => f.tank.side === 'player')).toHaveLength(0)
    scene.devSpawnPowerUp(0, 'star')
    run(650)
    expect(scene.flickers.filter((f) => f.tank.side === 'player')).toHaveLength(1)
    scene.devSpawnPowerUp(0, 'shovel')
    run(700)
    scene.devSpawnPowerUp(0, 'helmet')
    run(STEP_MS)
    expect(scene.tanks.filter((t) => t.side === 'player')).toHaveLength(4)
    expect(session.players.map((p) => p.lives)).toEqual([0, 0, 0, 0])
    expect(events.filter((e) => e.type === 'life_gained')).toHaveLength(1)
  })

  it('nie dopisuje życia graczowi, który ma już zapas i odradza się normalnie', () => {
    const { session, scene, run, events } = setupRevival()
    session.players[1].lives = 2
    scene.devKillPlayer(1)
    scene.devSpawnPowerUp(0, 'helmet')
    run(1400)
    expect(scene.tanks.filter((t) => t.side === 'player')).toHaveLength(4)
    expect(session.players[1].lives).toBe(1)
    expect(events.filter((e) => e.type === 'life_gained')).toHaveLength(0)
  })
})
