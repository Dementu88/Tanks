import { describe, expect, it } from 'vitest'
import { stages } from '../src/stages'
import { runUntilPlaying, runUntilSpawned, setup } from './helpers'

describe('podgląd AI (tryb developera)', () => {
  it('wróg ma stan, cel i trasę w jednostkach gry', () => {
    const { session, run } = setup([stages[0]])
    runUntilPlaying(session, run)
    runUntilSpawned(session, run)
    run(1500)
    const bots = session.scene!.devDebug().filter((d) => d.side === 'bot')
    expect(bots.length).toBeGreaterThan(0)
    const withPath = bots.find((b) => b.path.length > 0)
    expect(withPath).toBeDefined()
    for (const [x, y] of withPath!.path) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(208)
      expect(y).toBeLessThanOrEqual(208)
    }
    expect(['eagle', 'wander']).toContain(withPath!.goal)
  })
})
