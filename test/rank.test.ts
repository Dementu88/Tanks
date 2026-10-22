import { afterEach, describe, expect, it } from 'vitest'
import PowerUp from '../src/engine/entities/PowerUp'
import { playerStatsTable, setPlayerStatsTable } from '../src/engine/tankStats'
import { bulletLimit, bulletSpeed } from '../src/engine/values'
import { makeStage, runUntilPlaying, runUntilSpawned, setup } from './helpers'

const original = playerStatsTable()
afterEach(() => {
  setPlayerStatsTable(original)
})

function playerTank(session: ReturnType<typeof setup>['session']) {
  return session.scene!.tanks.find((t) => t.side === 'player')!
}

describe('poziomy czołgu gracza LV1–LV5', () => {
  it('każda gwiazdka podnosi poziom, na LV5 daje premię punktową', () => {
    const { session, run } = setup([makeStage('t', ['20*basic'])])
    runUntilPlaying(session, run)
    runUntilSpawned(session, run)
    const tank = playerTank(session)
    expect(tank.rank).toBe(1)
    for (const expected of [2, 3, 4, 5]) {
      session.scene!.powerUps.push(new PowerUp('star', tank.x, tank.y))
      run(50)
      expect(tank.rank).toBe(expected)
    }
    const before = session.players[0].score
    session.scene!.powerUps.push(new PowerUp('star', tank.x, tank.y))
    run(50)
    expect(tank.rank).toBe(5)
    expect(session.players[0].score - before).toBeGreaterThanOrEqual(5000)
  })

  it('statystyki biorą się z tabeli i można je zmieniać w locie', () => {
    const { session, run } = setup([makeStage('t', ['20*basic'])])
    runUntilPlaying(session, run)
    runUntilSpawned(session, run)
    const tank = playerTank(session)
    expect(bulletSpeed(tank)).toBe(original[0].bulletSpeed)
    const table = playerStatsTable()
    table[0].bulletLimit = 4
    table[0].bulletSpeed = 0.3
    setPlayerStatsTable(table)
    expect(bulletLimit(tank)).toBe(4)
    expect(bulletSpeed(tank)).toBe(0.3)
  })

  it('wartości spoza zakresu są przycinane', () => {
    const [lv1] = setPlayerStatsTable([{ moveSpeed: 99, bulletLimit: -3 }])
    expect(lv1.moveSpeed).toBeLessThanOrEqual(0.2)
    expect(lv1.bulletLimit).toBe(1)
  })

  it('poziom przechodzi na następną planszę', () => {
    const { session, run } = setup([makeStage('a'), makeStage('b')])
    runUntilPlaying(session, run)
    runUntilSpawned(session, run)
    session.scene!.devSetRank(0, 5)
    session.scene!.reserveTanks()
    expect(session.players[0].reservedRank).toBe(5)
  })
})
