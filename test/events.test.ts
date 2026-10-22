import { describe, expect, it } from 'vitest'
import { STEP_MS } from '../src/engine/Game'
import GameSession from '../src/engine/GameSession'
import { resetBulletIds } from '../src/engine/entities/Bullet'
import { resetTankIds } from '../src/engine/entities/Tank'
import type { GameEvent } from '../src/engine/events'
import { seededRandom } from '../src/engine/random'
import InputManager from '../src/input/InputManager'
import { stages } from '../src/stages'
import { P1, P2 } from './helpers'

const LIMIT = 300_000

/** pełna gra AI kontra AI (托管) na pierwszej planszy; zwraca zdarzenia i końcowy stan */
function play(withEvents: boolean, seed = 7) {
  resetTankIds()
  resetBulletIds()
  const events: GameEvent[] = []
  const session = new GameSession(
    [stages[0]],
    0,
    [
      { ...P1, id: 'tata' },
      { ...P2, id: 'asia' },
    ],
    { play: () => {} },
    {
      autopilot: true,
      random: seededRandom(seed),
      events: withEvents ? { emit: (e) => events.push(e) } : undefined,
    },
  )
  const input = new InputManager()
  let elapsed = 0
  while (session.phase !== 'ended' && elapsed < LIMIT) {
    session.step(STEP_MS, input)
    elapsed += STEP_MS
  }
  return { events, session }
}

// pełne gry AI kontra AI — przy równoległych testach potrafią trwać kilka sekund
describe('zdarzenia rozgrywki', { timeout: 30000 }, () => {
  it('opisują przebieg gry z identyfikatorami graczy', () => {
    const { events } = play(true)
    const types = new Set(events.map((e) => e.type))
    expect(events[0]).toMatchObject({ type: 'stage_started', playerIds: ['tata', 'asia'] })
    for (const t of ['player_spawned', 'shot', 'bot_hit', 'bot_killed'] as const) {
      expect(types.has(t)).toBe(true)
    }
    for (const e of events) {
      if ('playerId' in e && e.playerId != null) expect(['tata', 'asia']).toContain(e.playerId)
    }
    // gra kończy się przejściem planszy albo porażką — dokładnie jednym z tych zdarzeń
    const endings = events.filter((e) => e.type === 'stage_cleared' || e.type === 'game_over')
    expect(endings).toHaveLength(1)
  })

  it('zabicia w podsumowaniu planszy zgadzają się z pojedynczymi zdarzeniami', () => {
    // szukamy ziarna, na którym AI przechodzi planszę
    let events: GameEvent[] = []
    let cleared: Extract<GameEvent, { type: 'stage_cleared' }> | undefined
    for (let seed = 1; seed <= 6 && cleared == null; seed += 1) {
      events = play(true, seed).events
      cleared = events.find((e) => e.type === 'stage_cleared')
    }
    expect(cleared).toBeDefined()
    if (cleared == null) return
    for (const p of cleared.players) {
      const kills = events.filter((e) => e.type === 'bot_killed' && e.playerId === p.playerId)
      const total = Object.values(p.kills).reduce((a, b) => a + b, 0)
      expect(kills).toHaveLength(total)
    }
  })

  it('odbiorca zdarzeń nie zmienia przebiegu gry', () => {
    const a = play(true).session.snapshot()
    const b = play(false).session.snapshot()
    expect(a).toEqual(b)
  })
})
