import { describe, expect, it } from 'vitest'
import Bullet from '../src/engine/entities/Bullet'
import type Tank from '../src/engine/entities/Tank'
import { updateBullets, type BulletTankHit } from '../src/engine/systems/bullet'
import { makeStage, runUntilPlaying, runUntilSpawned, setup } from './helpers'

describe('tarcza odrodzenia wroga', () => {
  it.each([false, true])('chroni przez 3 sekundy po animacji, zamrożenie: %s', (frozen) => {
    const { session, run, input } = setup([makeStage('shield', ['1*armor'])])
    runUntilPlaying(session, run)
    const scene = session.scene!
    run(500)
    expect(scene.flickers.find((f) => f.tank.side === 'bot')!.tank.helmetDuration).toBe(3000)
    runUntilSpawned(session, run)
    const bot = scene.tanks.find((t) => t.side === 'bot')!
    expect(bot.helmetDuration).toBe(3000)
    scene.devFreezeBots(frozen)

    const shoot = (target: Tank) => {
      const bullets = [
        new Bullet({
          side: 'player',
          tankId: -1,
          direction: 'down',
          x: target.x + 6,
          y: target.y + 6,
          speed: 0,
          power: 3,
        }),
      ]
      const hits: BulletTankHit[] = []
      updateBullets(bullets, scene.map, [], { play: () => {} }, 0, [target], hits)
      expect(bullets).toHaveLength(0)
      return hits
    }
    expect(shoot(bot)).toHaveLength(0)
    for (let elapsed = 0; elapsed < 2990; elapsed += 10) {
      scene.step(10, input)
      scene.bullets.length = 0
    }
    scene.step(9, input)
    expect(bot.helmetDuration).toBe(1)
    expect(shoot(bot)).toHaveLength(0)
    expect(bot.hp).toBe(4)
    scene.step(1, input)
    expect(bot.helmetDuration).toBe(0)
    expect(shoot(bot)).toHaveLength(1)
  })
})
