import { describe, expect, it } from 'vitest'
import { PLAYER_COLORS, PLAYER_SPAWNS } from '../src/engine/constants'
import { carriesPowerUp, maxBotsOnField, scaleBots } from '../src/engine/difficulty'
import type { PlayerConfig } from '../src/engine/GameSession'
import type { TankLevel } from '../src/engine/types'
import { PLAYER1_CONTROL } from '../src/input/bindings'
import { makeStage, runUntilPlaying, runUntilSpawned, setup } from './helpers'

const players = (n: number): PlayerConfig[] =>
  Array.from({ length: n }, (_, i) => ({
    control: { ...PLAYER1_CONTROL, fire: `Fire${i}` },
    color: PLAYER_COLORS[i],
    spawnPos: PLAYER_SPAWNS[i],
  }))

describe('do 4 graczy', () => {
  it('trudność rośnie od 3 graczy, przy 1–2 jest jak w oryginale', () => {
    const base: TankLevel[] = Array.from({ length: 20 }, (_, i) => (i < 18 ? 'basic' : 'fast'))
    expect(scaleBots(base, 1)).toHaveLength(20)
    expect(scaleBots(base, 2)).toHaveLength(20)
    expect(scaleBots(base, 3)).toHaveLength(30)
    expect(scaleBots(base, 4)).toHaveLength(40)
    // kolejność typów zachowana: na końcu dalej szybkie
    expect(scaleBots(base, 4).slice(-4)).toEqual(['fast', 'fast', 'fast', 'fast'])
    expect([1, 2, 3, 4].map((n) => maxBotsOnField(n))).toEqual([4, 6, 7, 8])
    const bonusy = Array.from({ length: 40 }, (_, i) => i).filter((i) => carriesPowerUp(i))
    expect(bonusy).toEqual([3, 10, 17, 24, 31, 38])
  })

  it('4 graczy startuje, a miejsca startu 3 i 4 są czyste nawet w cegłach', () => {
    // cegły dokładnie tam, gdzie startują gracze 3 i 4 (wiersz 12, kolumny 2 i 10)
    const stage = makeStage('t', ['20*basic'], { '12,2': 'Bf', '12,10': 'Tf' })
    const { session, run } = setup([stage], players(4))
    runUntilPlaying(session, run)
    runUntilSpawned(session, run)
    run(2000)
    const tanks = session.scene!.tanks.filter((t) => t.side === 'player')
    expect(tanks).toHaveLength(4)
    expect(tanks.map((t) => t.color).sort()).toEqual(['blue', 'green', 'purple', 'yellow'])
    const map = session.scene!.map
    for (const pos of [PLAYER_SPAWNS[2], PLAYER_SPAWNS[3]]) {
      expect(
        map
          .brickIndicesIn({ x: pos.x, y: pos.y, width: 15, height: 15 })
          .filter((i) => map.bricks[i]),
      ).toHaveLength(0)
    }
    // 40 wrogów na planszy dla 4 graczy
    expect(
      session.scene!.remainingBotCount +
        session.scene!.tanks.filter((t) => t.side === 'bot').length,
    ).toBeGreaterThan(30)
  })
})
