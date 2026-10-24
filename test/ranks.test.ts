import { describe, expect, it } from 'vitest'
import { promotion, RANKS, rankIndex, rankProgress } from '../src/party/ranks'

describe('stopnie graczy', () => {
  it('zaczynamy od szeregowego, generał na końcu, progi rosną', () => {
    expect(RANKS[0]).toMatchObject({ nazwa: 'Szeregowy', xp: 0 })
    expect(RANKS[RANKS.length - 1].nazwa).toBe('Generał')
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i].xp).toBeGreaterThan(RANKS[i - 1].xp)
  })

  it('postęp do następnego stopnia i awans przy przekroczeniu progu', () => {
    const second = RANKS[1].xp
    expect(rankIndex(second - 1)).toBe(0)
    expect(rankIndex(second)).toBe(1)
    const half = rankProgress(second / 2)
    expect(half.next?.nazwa).toBe(RANKS[1].nazwa)
    expect(half.progress).toBeCloseTo(0.5)
    expect(promotion(second - 1, second)?.nazwa).toBe(RANKS[1].nazwa)
    expect(promotion(second, second + 1)).toBeNull()
    expect(rankProgress(1e9).progress).toBe(1)
    expect(rankProgress(1e9).next).toBeNull()
  })
})
