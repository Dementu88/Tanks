// @vitest-environment node
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createPartyServer } from '../server/party'
import { DEFAULT_XP_CONFIG } from '../src/engine/sessionXp'
import type { PartyRoomState, PartyServerMessage } from '../src/party/protocol'
import type { SceneFrame } from '../src/lan/frame'

it('XP serwera: wspólna pula, uprawnienia, zakup podczas pauzy, restart i klasyczna gra', async () => {
  const party = createPartyServer({
    dev: { saveStats: async () => {}, loadStats: async () => null },
  })
  const server = createServer()
  server.on('upgrade', (req, socket, head) => party.handleUpgrade(req, socket, head))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const sockets: WebSocket[] = []
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/party`)
    sockets.push(ws)
    let room: PartyRoomState | null = null
    let scene: SceneFrame | null = null
    let slot: number | null = null
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as PartyServerMessage
      if (msg.t === 'room') room = msg.room
      if (msg.t === 'f') scene = msg.scene
      if (msg.t === 'joined') slot = msg.slot
    })
    await new Promise((resolve) => ws.on('open', resolve))
    return {
      send: (msg: object) => ws.send(JSON.stringify(msg)),
      room: () => room,
      scene: () => scene,
      slot: () => slot,
    }
  }
  const wait = async (check: () => boolean) => {
    const end = Date.now() + 6000
    while (!check()) {
      if (Date.now() > end) throw new Error('timeout')
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80))
  try {
    const tv = await connect()
    tv.send({ t: 'tv' })
    await wait(() => tv.room() != null)
    const p1 = await connect(),
      p2 = await connect()
    p1.send({ t: 'pad', code: tv.room()!.code, device: 'test-tv-pad0' })
    await wait(() => p1.slot() === 0)
    p2.send({ t: 'pad', code: tv.room()!.code, device: 'test-tv-pad1' })
    await wait(() => p2.slot() === 1)
    const config = {
      ...DEFAULT_XP_CONFIG,
      enabled: true,
      // pancerz tani, żeby wystarczył jeden wróg z granatu przy nagrodzie z configu
      costs: { speed: 100, fire: 100, armor: 10 },
    }
    p2.send({ t: 'xp-config', config })
    await settle()
    // drugi gracz nie zarządza pulą — ceny zostają z configu
    expect(tv.room()!.xp!.config.costs.speed).toBe(DEFAULT_XP_CONFIG.costs.speed)
    // Ekran pozwala ustawić XP również wtedy, gdy gracze mają tylko sprzętowe pady.
    tv.send({ t: 'xp-config', config })
    await wait(() => tv.room()!.xp!.config.costs.speed === 100)
    p1.send({ t: 'start' })
    tv.send({ t: 'dev', action: { a: 'freeze-bots', on: true } })
    await wait(
      () =>
        tv.scene()?.tanks.filter((t) => t[1] === 0).length === 2 &&
        tv.scene()!.tanks.some((t) => t[1] === 1),
    )
    p1.send({ t: 'xp-config', config: { ...config, enabled: false } })
    tv.send({ t: 'dev', action: { a: 'powerup', slot: 0, name: 'grenade' } })
    await wait(() => tv.room()!.xp!.bank >= 10)
    p1.send({ t: 'pause' })
    await wait(() => tv.room()!.paused)
    const bank = tv.room()!.xp!.bank
    expect(tv.room()!.xp!.config.enabled).toBe(true)
    p2.send({ t: 'xp-buy', trait: 'armor' })
    await settle()
    expect(tv.room()!.xp!.levels.armor).toBe(0)
    p1.send({ t: 'xp-buy', trait: 'armor' })
    await wait(() => tv.room()!.xp!.levels.armor === 1)
    await wait(() =>
      tv
        .scene()!
        .tanks.filter((t) => t[1] === 0)
        .every((t) => t[8] === 2 && t[11] === 2),
    )
    expect(p2.room()!.xp!.bank).toBe(bank - 10)
    p1.send({ t: 'restart' })
    await wait(() => !tv.room()!.paused)
    await wait(() => tv.scene()?.tanks.filter((t) => t[1] === 0).length === 2)
    expect(
      tv
        .scene()!
        .tanks.filter((t) => t[1] === 0)
        .every((t) => t[8] === 2),
    ).toBe(true)
    expect(tv.room()!.xp!.levels.armor).toBe(1)
    p1.send({ t: 'quit' })
    await wait(() => !tv.room()!.playing)
    tv.send({ t: 'xp-config', config: { ...config, enabled: false } })
    await wait(() => !tv.room()!.xp!.config.enabled)
    p1.send({ t: 'start' })
    await wait(() => tv.room()!.playing)
    await wait(
      () =>
        tv.scene()?.tanks.filter((t) => t[1] === 0).length === 2 &&
        tv
          .scene()!
          .tanks.filter((t) => t[1] === 0)
          .every((t) => t[8] === 1),
    )
    expect(tv.room()!.xp!.levels.armor).toBe(1)
    expect(tv.room()!.xp!.bank).toBe(bank - 10)
    const otherTv = await connect()
    otherTv.send({ t: 'tv' })
    await wait(() => otherTv.room() != null)
    expect(otherTv.room()!.xp).toEqual(tv.room()!.xp)
  } finally {
    for (const ws of sockets) ws.terminate()
    party.close()
    await new Promise((resolve) => server.close(resolve))
  }
}, 20000)
