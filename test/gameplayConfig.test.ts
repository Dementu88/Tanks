import { afterEach, expect, it, vi } from 'vitest'
import raw from '../config/rozgrywka.json'
import { parseGameplayConfig } from '../src/engine/gameplayConfig'

afterEach(() => {
  vi.doUnmock('../config/rozgrywka.json')
  vi.resetModules()
})

it('XP za każdy typ wroga pochodzi z configu, także przy granacie; wynik gry jest niezależny', async () => {
  vi.resetModules()
  const killRewards = { basic: 0, fast: 7, power: 19, armor: 53 }
  vi.doMock('../config/rozgrywka.json', () => ({
    default: { ...raw, xp: { ...raw.xp, enabled: true, killRewards } },
  }))
  const { SessionXp, DEFAULT_XP_CONFIG } = await import('../src/engine/sessionXp')
  const { TANK_KILL_SCORE_MAP } = await import('../src/engine/constants')
  const xp = new SessionXp()
  let total = 0
  for (const level of ['basic', 'fast', 'power', 'armor'] as const) {
    for (const by of ['bullet', 'grenade'] as const) {
      xp.record({ type: 'bot_killed', time: 0, playerId: 'p1', level, by, score: 9999 })
      total += killRewards[level]
      expect(xp.snapshot()).toMatchObject({ bank: total, earned: total })
    }
  }
  expect(TANK_KILL_SCORE_MAP).toEqual({ basic: 100, fast: 200, power: 300, armor: 400 })
  xp.configure({ ...DEFAULT_XP_CONFIG, enabled: false })
  expect(
    xp.record({
      type: 'bot_killed',
      time: 0,
      playerId: 'p1',
      level: 'armor',
      by: 'bullet',
      score: 400,
    }),
  ).toBe(false)
  expect(xp.snapshot().bank).toBe(total)
})

it('odrzuca nieprawidłową nagrodę XP ze wskazaniem typu wroga', () => {
  for (const armor of [-1, 1.5, 1000001, NaN]) {
    expect(() =>
      parseGameplayConfig({
        ...raw,
        xp: { ...raw.xp, killRewards: { ...raw.xp.killRewards, armor } },
      }),
    ).toThrow('xp.killRewards.armor')
  }
})

it('konfiguracja odrzuca zły poziom, ujemny czas tarczy i XP powyżej limitu', () => {
  expect(() => parseGameplayConfig({ ...raw, playerStartRank: 0 })).toThrow('playerStartRank')
  expect(() => parseGameplayConfig({ ...raw, enemySpawnShieldMs: -1 })).toThrow(
    'enemySpawnShieldMs',
  )
  expect(() => parseGameplayConfig({ ...raw, xp: { ...raw.xp, maxLevel: 0 } })).toThrow('maxLevel')
  expect(() =>
    parseGameplayConfig({
      ...raw,
      xp: { ...raw.xp, startLevels: { speed: 99, fire: 0, armor: 0, bullet: 0, shield: 0 } },
    }),
  ).toThrow('startLevels.speed')
})

it('ustawienia z pliku zmieniają start i odrodzenie, tarcze, poziomy początkowe oraz limit XP', async () => {
  vi.resetModules()
  vi.doMock('../config/rozgrywka.json', () => ({
    default: {
      ...raw,
      playerStartRank: 2,
      playerSpawnShieldMs: 1500,
      enemySpawnShieldMs: 4000,
      bonusShieldMs: 6000,
      xp: {
        ...raw.xp,
        enabled: true,
        maxLevel: 5,
        startLevels: { speed: 1, fire: 0, armor: 2 },
        costs: { speed: 100, fire: 100, armor: 100 },
        killRewards: { basic: 100, fast: 200, power: 300, armor: 400 },
      },
    },
  }))
  const { SessionXp } = await import('../src/engine/sessionXp')
  const { ControlLabSimulation } = await import('../src/party/ControlLabSimulation')
  const { default: GameSession } = await import('../src/engine/GameSession')
  const { makeStage, P1, runUntilPlaying, runUntilSpawned } = await import('./helpers')
  const { default: InputManager } = await import('../src/input/InputManager')
  const { STEP_MS } = await import('../src/engine/Game')
  const { BOT_SPAWN_HELMET_DURATION, HELMET_POWERUP_DURATION } =
    await import('../src/engine/constants')
  const xp = new SessionXp()
  expect(xp.snapshot()).toMatchObject({
    maxLevel: 5,
    levels: { speed: 1, fire: 0, armor: 2 },
    bank: 0,
  })
  for (let i = 0; i < 10; i++)
    xp.record({
      type: 'bot_killed',
      time: 0,
      playerId: 'p1',
      level: 'armor',
      by: 'bullet',
      score: 400,
    })
  for (let i = 0; i < 4; i++) expect(xp.buy('speed')).toBe(true)
  expect(xp.buy('speed')).toBe(false)
  expect(xp.snapshot().levels.speed).toBe(5)
  expect(BOT_SPAWN_HELMET_DURATION).toBe(4000)
  expect(HELMET_POWERUP_DURATION).toBe(6000)
  const session = new GameSession(
    [makeStage('config', ['20*basic'])],
    0,
    [P1],
    { play: () => {} },
    { autopilot: false, sessionBonuses: () => xp.bonuses(), random: () => 0.5 },
  )
  const input = new InputManager()
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += STEP_MS) {
      session.step(STEP_MS, input)
      input.endTick()
    }
  }
  runUntilPlaying(session, run)
  expect(session.scene!.flickers.find((f) => f.tank.side === 'player')!.tank.helmetDuration).toBe(
    1500,
  )
  runUntilSpawned(session, run)
  const scene = session.scene!
  scene.devFreezeBots(true)
  expect(scene.tanks.find((t) => t.side === 'player')).toMatchObject({
    rank: 2,
    hp: 3,
  })
  expect(scene.tanks.find((t) => t.side === 'bot')!.helmetDuration).toBe(4000)
  scene.devSetRank(0, 5)
  scene.devKillPlayer(0)
  run(1800)
  expect(scene.tanks.find((t) => t.side === 'player')).toMatchObject({ rank: 2, hp: 3 })
  const lab = new ControlLabSimulation(false)
  expect(lab.tank.rank).toBe(2)
  expect(lab.tank.helmetDuration).toBe(0)
})
