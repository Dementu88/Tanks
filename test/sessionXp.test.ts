import { describe, expect, it } from 'vitest'
import {
  DEFAULT_XP_CONFIG,
  SessionXp,
  parseXpConfig,
  xpConfigError,
  xpCost,
} from '../src/engine/sessionXp'
import type { GameEvent } from '../src/engine/events'
import GameSession from '../src/engine/GameSession'
import { STEP_MS } from '../src/engine/Game'
import { seededRandom } from '../src/engine/random'
import InputManager from '../src/input/InputManager'
import Bullet from '../src/engine/entities/Bullet'
import { bulletInterval, bulletSpeed, moveSpeed } from '../src/engine/values'
import { SceneEncoder, SceneMirror } from '../src/lan/frame'
import { tankColor } from '../src/render/tankColor'
import { P1, P2, makeStage, runUntilPlaying, runUntilSpawned } from './helpers'
import { GAMEPLAY } from '../src/engine/gameplayConfig'

const kill: GameEvent = {
  type: 'bot_killed',
  time: 0,
  playerId: 'p1',
  level: 'armor',
  score: 0,
  by: 'grenade',
}
const config = { ...DEFAULT_XP_CONFIG, enabled: true, costs: { speed: 100, fire: 100, armor: 100 } }
/** XP za opancerzonego wroga z config/rozgrywka.json */
const R = GAMEPLAY.xpKillRewards.armor
function funded() {
  const xp = new SessionXp()
  xp.configure(config)
  for (let i = 0; i < 10; i++) xp.record(kill)
  return xp
}
describe('wspólny XP sesji', () => {
  it('przyjmuje duże ceny z configu i wskazuje konkretne błędne pole', () => {
    const large = { ...config, costs: { speed: 10000, fire: 10000, armor: 15000 } }
    const xp = new SessionXp()
    expect(xp.configure(large)).toBe(true)
    // ile opancerzonych wrogów trzeba na LV1 pancerza przy nagrodzie z configu
    const kills = Math.ceil(15000 / R)
    for (let i = 0; i < kills - 1; i++) xp.record(kill)
    expect(xp.buy('armor')).toBe(false)
    xp.record(kill)
    expect(xp.buy('armor')).toBe(true)
    expect(xp.snapshot().bank).toBe(kills * R - 15000)
    expect(xpCost(xp.snapshot(), 'armor')).toBe(30000)
    expect(
      parseXpConfig({ ...large, costs: { speed: 1, fire: 12345, armor: 1000000 } }),
    ).not.toBeNull()
    for (const armor of [0, 1000001, 1.5, NaN]) {
      const invalid = { ...large, costs: { ...large.costs, armor } }
      expect(parseXpConfig(invalid)).toBeNull()
      expect(xpConfigError(invalid)).toContain('xp.costs.armor')
    }
  })
  it('wyłączone XP nic nie daje; granat daje XP, zakup ma rosnący koszt i limit 3', () => {
    const xp = new SessionXp()
    xp.configure({ ...config, enabled: false })
    expect(xp.record(kill)).toBe(false)
    // ceny tak, żeby jedno zestrzelenie wystarczyło na LV1 + LV2 (jak przy 400 XP i cenie 100)
    xp.configure({ ...config, costs: { ...config.costs, speed: R / 4 } })
    xp.record(kill)
    expect(xp.snapshot().bank).toBe(R)
    expect(xp.buy('speed')).toBe(true)
    expect(xp.buy('speed')).toBe(true)
    expect(xp.buy('speed')).toBe(false)
    expect(xp.snapshot().levels).toEqual({ speed: 2, fire: 0, armor: 0, bullet: 0, shield: 0 })
    xp.record(kill)
    expect(xp.buy('speed')).toBe(true)
    expect(xp.buy('speed')).toBe(false)
    expect(xp.snapshot().bank).toBe(R / 2)
    expect(xp.snapshot().earned).toBe(2 * R)
    expect(xp.buy('toString')).toBe(false)
  })
  it('wyłączenie zawiesza XP i premie, włączenie przywraca; nowy serwer zaczyna od zera', () => {
    const xp = funded()
    xp.buy('armor')
    const before = xp.snapshot()
    xp.configure({ ...config, enabled: false })
    expect(xp.record(kill)).toBe(false)
    expect(xp.buy('speed')).toBe(false)
    expect(xp.bonuses().extraHp).toBe(0)
    xp.configure(config)
    expect(xp.snapshot()).toEqual(before)
    expect(xp.bonuses().extraHp).toBe(1)
    expect(new SessionXp().snapshot().bank).toBe(0)
    const copy = xp.snapshot()
    copy.config.costs.armor = 9999
    copy.levels.armor = 3
    expect(xp.snapshot()).toEqual(before)
  })
  it('odrzuca ujemne ceny, NaN, ułamki i brakujące pola', () => {
    for (const raw of [
      null,
      {},
      { ...config, costs: { ...config.costs, fire: -1 } },
      { ...config, speedPercent: NaN },
      { ...config, armorHp: 1.5 },
      { ...config, enabled: 'yes' },
    ]) {
      expect(parseXpConfig(raw)).toBeNull()
    }
  })
  it('premie obejmują całą drużynę, pancerz zużywa się i wraca po odrodzeniu oraz nowej grze', () => {
    const xp = funded()
    const create = () =>
      new GameSession(
        [makeStage('XP', ['20*basic'])],
        0,
        [P1, P2],
        { play: () => {} },
        { autopilot: false, random: seededRandom(1), sessionBonuses: () => xp.bonuses() },
      )
    const session = create()
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
    const players = scene.tanks.filter((t) => t.side === 'player')
    const speed = moveSpeed(players[0])
    const interval = bulletInterval(players[0])
    xp.buy('speed')
    xp.buy('fire')
    xp.buy('armor')
    scene.refreshSessionBonuses()
    for (const player of players) {
      expect(moveSpeed(player)).toBeCloseTo(speed * 1.1)
      expect(bulletInterval(player)).toBeCloseTo(interval / 1.15)
      expect(player.hp).toBe(2)
    }
    const target = players[0]
    target.helmetDuration = 0
    const shoot = () => {
      scene.bullets.push(
        new Bullet({
          side: 'bot',
          tankId: -1,
          direction: 'down',
          speed: 0,
          power: 1,
          x: target.x + 6,
          y: target.y + 6,
        }),
      )
      run(STEP_MS)
    }
    shoot()
    expect(target.hp).toBe(1)
    expect(target.alive).toBe(true)
    run(200)
    expect(target.hp).toBe(1)
    xp.buy('armor')
    scene.refreshSessionBonuses()
    expect(target.hp).toBe(2)
    expect(players[1].hp).toBe(3)
    expect(tankColor(target, target.bornAt)).toBe('green')
    const mirror = new SceneMirror()
    mirror.apply(new SceneEncoder().encode(scene))
    expect(mirror.tanks.find((t) => t.tankId === target.tankId)).toMatchObject({ hp: 2, maxHp: 3 })
    shoot()
    shoot()
    expect(target.alive).toBe(false)
    run(1800)
    expect(scene.tanks.find((t) => t.side === 'player' && t.color === target.color)).toMatchObject({
      hp: 3,
      maxHp: 3,
    })
    const next = create()
    const runNext = (ms: number) => {
      for (let t = 0; t < ms; t += STEP_MS) next.step(STEP_MS, input)
    }
    runUntilPlaying(next, runNext)
    runUntilSpawned(next, runNext)
    expect(next.scene!.tanks.filter((t) => t.side === 'player').every((t) => t.hp === 3)).toBe(true)
  })
})

describe('nowe ulepszenia XP: szybsze pociski i dłuższa tarcza', () => {
  it('stary zapis bez nowych pól dostaje wartości domyślne', () => {
    const { bulletPercent: _b, shieldMs: _s, ...old } = DEFAULT_XP_CONFIG
    const parsed = parseXpConfig({ ...old, costs: { speed: 1, fire: 1, armor: 1 } })
    expect(parsed?.costs.bullet).toBeGreaterThan(0)
    expect(parsed?.shieldMs).toBeGreaterThan(0)
    expect(xpConfigError({ ...DEFAULT_XP_CONFIG, shieldMs: 100 })).toContain('shieldMs')
  })

  it('pociski lecą szybciej, a odrodzony czołg ma dłuższą tarczę', () => {
    const xp = new SessionXp()
    xp.configure({
      ...DEFAULT_XP_CONFIG,
      enabled: true,
      costs: { ...DEFAULT_XP_CONFIG.costs, bullet: 100, shield: 100 },
    })
    for (let i = 0; i < 10; i++) xp.record(kill)
    const session = new GameSession(
      [makeStage('XP', ['20*basic'])],
      0,
      [P1],
      { play: () => {} },
      { autopilot: false, random: seededRandom(1), sessionBonuses: () => xp.bonuses() },
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
    const tank = scene.tanks.find((t) => t.side === 'player')!
    const speed = bulletSpeed(tank)
    const helmet = tank.helmetDuration
    expect(xp.buy('bullet')).toBe(true)
    expect(xp.buy('shield')).toBe(true)
    scene.refreshSessionBonuses()
    expect(bulletSpeed(tank)).toBeCloseTo(speed * (1 + DEFAULT_XP_CONFIG.bulletPercent / 100))
    // zakup nie dokłada tarczy żywemu czołgowi — dopiero odrodzenie
    expect(tank.helmetDuration).toBeLessThanOrEqual(helmet)
    expect(xp.bonuses().extraShieldMs).toBe(DEFAULT_XP_CONFIG.shieldMs)
  })
})
