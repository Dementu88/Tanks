// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createPartyServer } from '../server/party'
import {
  carriesPowerUp,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_LEVELS,
  maxBotsOnField,
  scaleBots,
  spawnIntervalFactor,
  startLives,
} from '../src/engine/difficulty'
import type { TankLevel } from '../src/engine/types'

const base: TankLevel[] = Array.from({ length: 20 }, (_, i) =>
  i < 10 ? 'basic' : i < 15 ? 'fast' : i < 18 ? 'power' : 'armor',
)
const strength = (bots: TankLevel[]) =>
  bots.reduce((s, t) => s + ['basic', 'fast', 'power', 'armor'].indexOf(t), 0)

describe('poziomy trudności', () => {
  it('Normalny (domyślny) = oryginał', () => {
    expect(DIFFICULTY_LEVELS[DEFAULT_DIFFICULTY].nazwa).toBe('Normalny')
    expect(scaleBots(base, 1, DEFAULT_DIFFICULTY)).toEqual(base)
    expect(scaleBots(base, 1)).toEqual(base)
    expect(maxBotsOnField(1, DEFAULT_DIFFICULTY)).toBe(4)
    expect(startLives(DEFAULT_DIFFICULTY)).toBe(3)
    expect(spawnIntervalFactor(DEFAULT_DIFFICULTY)).toBe(1)
    const bonusy = Array.from({ length: 20 }, (_, i) => i).filter((i) => carriesPowerUp(i))
    expect(bonusy).toEqual([3, 10, 17])
  })

  it('każdy kolejny poziom jest trudniejszy: więcej, mocniejszych i szybciej', () => {
    for (let lv = 1; lv < DIFFICULTY_LEVELS.length; lv += 1) {
      const easier = scaleBots(base, 2, lv - 1)
      const harder = scaleBots(base, 2, lv)
      expect(harder.length).toBeGreaterThanOrEqual(easier.length)
      expect(strength(harder) / harder.length).toBeGreaterThanOrEqual(
        strength(easier) / easier.length,
      )
      expect(maxBotsOnField(2, lv)).toBeGreaterThanOrEqual(maxBotsOnField(2, lv - 1))
      expect(spawnIntervalFactor(lv)).toBeLessThanOrEqual(spawnIntervalFactor(lv - 1))
      expect(startLives(lv)).toBeLessThanOrEqual(startLives(lv - 1))
    }
    // kolejka zostaje uporządkowana od słabszych do mocniejszych mniej więcej jak w oryginale
    expect(scaleBots(base, 4, 3).length).toBe(64)
  })

  it('poziom i restart wybiera tylko pierwszy gracz', async () => {
    const party = createPartyServer({ maxConnections: 8 })
    const server: Server = createServer((_q, r) => r.writeHead(404).end())
    server.on('upgrade', (req, socket, head) => {
      if (!party.handleUpgrade(req, socket, head)) socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    type Msg = { t: string; [k: string]: any }
    const open = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/party`)
      const seen: Msg[] = []
      ws.on('message', (d) => seen.push(JSON.parse(d.toString())))
      await new Promise<void>((r) => ws.on('open', () => r()))
      const last = () => [...seen].reverse().find((m) => m.t === 'room')?.room
      return { ws, seen, last, send: (m: object) => ws.send(JSON.stringify(m)) }
    }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    try {
      const tv = await open()
      tv.send({ t: 'tv' })
      await wait(100)
      const code = tv.seen.find((m) => m.t === 'joined')!.code
      const p1 = await open()
      p1.send({ t: 'pad', code, device: 'p1-xxxx' })
      const p2 = await open()
      p2.send({ t: 'pad', code, device: 'p2-xxxx' })
      await wait(150)
      expect(tv.last().difficulty).toBe(DEFAULT_DIFFICULTY)
      expect(tv.last().difficultyChooser).toBe(0)
      p2.send({ t: 'difficulty', delta: 1 })
      await wait(100)
      expect(tv.last().difficulty).toBe(DEFAULT_DIFFICULTY)
      p1.send({ t: 'difficulty', delta: 1 })
      await wait(100)
      expect(tv.last().difficulty).toBe(DEFAULT_DIFFICULTY + 1)
      // Gracz 1 wychodzi — wybiera teraz następny
      p1.ws.close()
      await wait(150)
      expect(tv.last().difficultyChooser).toBe(1)
      p2.send({ t: 'difficulty', delta: -1 })
      await wait(100)
      expect(tv.last().difficulty).toBe(DEFAULT_DIFFICULTY)
      // restart z menu: tylko pierwszy gracz, w trakcie gry
      const p3 = await open()
      p3.send({ t: 'pad', code, device: 'p3-xxxx', slot: 2 })
      await wait(100)
      p2.send({ t: 'start' })
      await wait(200)
      expect(tv.last().playing).toBe(true)
      const starts = () => tv.seen.filter((m) => m.t === 'start').length
      const before = starts()
      p3.send({ t: 'restart' })
      await wait(200)
      expect(starts()).toBe(before)
      p2.send({ t: 'restart' })
      await wait(200)
      expect(starts()).toBe(before + 1)
      expect(tv.last().playing).toBe(true)
      p3.ws.close()
      for (const c of [tv, p2]) c.ws.close()
    } finally {
      party.close()
      await new Promise((r) => server.close(r))
    }
  })
})
