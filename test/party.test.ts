// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createPartyServer, type PartyServer } from '../server/party'
import type { GameEvent } from '../src/engine/events'
import { INPUT_TURN_ONLY } from '../src/party/protocol'

type Msg = { t: string; [k: string]: unknown }

function connect(port: number, key?: string) {
  const query = key == null ? '' : `?k=${encodeURIComponent(key)}`
  const ws = new WebSocket(`ws://127.0.0.1:${port}/party${query}`)
  const seen: Msg[] = []
  ws.on('message', (d) => seen.push(JSON.parse(d.toString())))
  const opened = new Promise<void>((resolve) => ws.on('open', () => resolve()))
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
  ws.on('error', () => {})
  const send = (msg: object) => ws.send(JSON.stringify(msg))
  const waitFor = async (pred: (m: Msg) => boolean, ms = 3000): Promise<Msg> => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const hit = seen.find(pred)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('timeout')
  }
  return { ws, seen, opened, closed, send, waitFor }
}

describe('party server', () => {
  let server: Server
  let party: PartyServer
  let port: number
  const KEY = 'rodzinka-123'
  let gameEvents: GameEvent[] = []

  beforeEach(async () => {
    gameEvents = []
    party = createPartyServer({
      key: KEY,
      maxConnections: 8,
      onGameEvent: (e) => gameEvents.push(e),
    })
    server = createServer((_req, res) => res.writeHead(404).end())
    server.on('upgrade', (req, socket, head) => {
      if (!party.handleUpgrade(req, socket, head)) socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    party.close()
    await new Promise((resolve) => server.close(resolve))
  })

  it('TV zakłada pokój, pady dołączają, gra wysyła klatki do wszystkich TV', async () => {
    const tv = connect(port, KEY)
    await tv.opened
    tv.send({ t: 'tv' })
    const joined = await tv.waitFor((m) => m.t === 'joined')
    const code = joined.code as string
    expect(code).toMatch(/^\d{4}$/)

    const pads = Array.from({ length: 5 }, () => connect(port, KEY))
    await Promise.all(pads.map((p) => p.opened))
    // po kolei, żeby kolejność slotów nie zależała od wyścigu połączeń; mieszczą się 4 pady
    for (let i = 0; i < 4; i += 1) {
      pads[i].send({ t: 'pad', code })
      expect((await pads[i].waitFor((m) => m.t === 'joined')).slot).toBe(i)
    }
    pads[4].send({ t: 'pad', code })
    await pads[4].waitFor((m) => m.t === 'error')

    pads[0].send({ t: 'start' })
    await tv.waitFor((m) => m.t === 'start')
    await tv.waitFor((m) => m.t === 'f' && (m.scene as { map?: unknown } | null)?.map != null, 5000)

    // drugie TV w trakcie gry dostaje od razu pełną mapę
    const tv2 = connect(port, KEY)
    await tv2.opened
    tv2.send({ t: 'tv', code })
    await tv2.waitFor((m) => m.t === 'start')
    await tv2.waitFor((m) => m.t === 'f' && (m.scene as { map?: unknown } | null)?.map != null)

    pads[1].send({ t: 'quit' })
    await tv.waitFor((m) => m.t === 'room' && (m.room as { playing: boolean }).playing === false)
    for (const c of [tv, tv2, ...pads]) c.ws.close()
  })

  it('jeden pokój: TV bez kodu i pad ze starym kodem trafiają do istniejącego', async () => {
    const tv = connect(port, KEY)
    await tv.opened
    tv.send({ t: 'tv' })
    const code = (await tv.waitFor((m) => m.t === 'joined')).code
    const tv2 = connect(port, KEY)
    await tv2.opened
    tv2.send({ t: 'tv' })
    expect((await tv2.waitFor((m) => m.t === 'joined')).code).toBe(code)
    const pad = connect(port, KEY)
    await pad.opened
    pad.send({ t: 'pad', code: '0001' })
    expect((await pad.waitFor((m) => m.t === 'joined')).code).toBe(code)
    expect(party.rooms()).toBe(1)
    for (const c of [tv, tv2, pad]) c.ws.close()
  })

  it('najwyżej 4 ekrany w pokoju', async () => {
    const tvs = Array.from({ length: 5 }, () => connect(port, KEY))
    for (const tv of tvs) {
      await tv.opened
      tv.send({ t: 'tv' })
      await tv.waitFor((m) => m.t === 'joined' || m.t === 'error')
    }
    expect(tvs.filter((tv) => tv.seen.some((m) => m.t === 'joined'))).toHaveLength(4)
    await tvs[4].waitFor((m) => m.t === 'error')
    for (const tv of tvs) tv.ws.close()
  })

  it('bez klucza albo ze złym kluczem połączenie jest zamykane', async () => {
    for (const key of [undefined, 'zly']) {
      const c = connect(port, key)
      expect(await c.closed).toBe(4001)
    }
    expect(party.rooms()).toBe(0)
  })

  it('limit połączeń', async () => {
    const clients = Array.from({ length: 8 }, () => connect(port, KEY))
    await Promise.all(clients.map((c) => c.opened))
    const extra = connect(port, KEY)
    // serwer odpowiada 503 zamiast przełączyć na WebSocket
    await extra.closed
    expect(extra.seen).toHaveLength(0)
    for (const c of clients) c.ws.close()
  })

  it('małe wychylenie obraca czołg w miejscu, duże nim jedzie', async () => {
    const tv = connect(port, KEY)
    await tv.opened
    tv.send({ t: 'tv' })
    const code = (await tv.waitFor((m) => m.t === 'joined')).code
    const pad = connect(port, KEY)
    await pad.opened
    pad.send({ t: 'pad', code })
    await pad.waitFor((m) => m.t === 'joined')
    pad.send({ t: 'start' })

    type Tuple = number[]
    const playerTank = (): Tuple | undefined => {
      for (let i = tv.seen.length - 1; i >= 0; i -= 1) {
        const m = tv.seen[i]
        if (m.t !== 'f') continue
        const tanks = (m.scene as { tanks: Tuple[] } | null)?.tanks ?? []
        // [id, side, level, color, direction, x, y, flags…]; side 0 = gracz
        return tanks.find((t) => t[1] === 0)
      }
      return undefined
    }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    for (let i = 0; i < 100 && playerTank() == null; i += 1) await wait(100)
    const start = playerTank()!
    expect(start).toBeDefined()

    const RIGHT = 4 // lan/input: up=1, down=2, left=3, right=4
    pad.send({ t: 'in', b: RIGHT | INPUT_TURN_ONLY })
    await wait(400)
    const turned = playerTank()!
    expect(turned[4]).toBe(1) // frame: up=0, right=1
    expect(Math.abs(turned[5] - start[5])).toBeLessThanOrEqual(8) // tylko przyciągnięcie do siatki

    pad.send({ t: 'in', b: RIGHT })
    await wait(600)
    expect(playerTank()![5]).toBeGreaterThan(turned[5] + 4)
    pad.send({ t: 'in', b: 0 })
    await wait(100)
    const stoppedX = playerTank()![5]
    pad.send({ t: 'sensitivity', turnSnap: 0 })
    pad.send({ t: 'in', b: 1 | INPUT_TURN_ONLY })
    await wait(100)
    expect(playerTank()![5]).toBe(stoppedX)
    pad.send({ t: 'sensitivity', turnSnap: 16 })
    pad.send({ t: 'in', b: RIGHT | INPUT_TURN_ONLY })
    await wait(100)
    // Niepoprawna wartość nie może nadpisać poprzedniego ustawienia.
    pad.send({ t: 'sensitivity', turnSnap: 3 })
    pad.send({ t: 'in', b: 1 | INPUT_TURN_ONLY })
    await wait(100)
    expect(playerTank()![5] % 16).toBe(0)
    for (const c of [tv, pad]) c.ws.close()
  }, 20000)

  it('ten sam telefon zastępuje swoje stare połączenie, inny może przejąć slot', async () => {
    const tv = connect(port, KEY)
    await tv.opened
    tv.send({ t: 'tv' })
    const code = (await tv.waitFor((m) => m.t === 'joined')).code
    const join = async (device: string, extra: object = {}) => {
      const c = connect(port, KEY)
      await c.opened
      c.send({ t: 'pad', code, device, ...extra })
      return c
    }
    const ghost = await join('telefon-asi-1')
    expect((await ghost.waitFor((m) => m.t === 'joined')).slot).toBe(0)
    const me = await join('telefon-taty-1')
    expect((await me.waitFor((m) => m.t === 'joined')).slot).toBe(1)

    // ten sam telefon Asi otwiera pad drugi raz (np. podgląd QR + przeglądarka)
    const asia = await join('telefon-asi-1')
    expect((await asia.waitFor((m) => m.t === 'joined')).slot).toBe(0)
    expect(await ghost.closed).toBe(4002)

    // gracze 3 i 4 zajmują resztę miejsc
    const p3 = await join('telefon-p3-xx')
    expect((await p3.waitFor((m) => m.t === 'joined')).slot).toBe(2)
    const p4 = await join('telefon-p4-xx')
    expect((await p4.waitFor((m) => m.t === 'joined')).slot).toBe(3)

    // piąty telefon: wszystkie zajęte, ale może przejąć wybrany slot
    const guest = await join('telefon-gosc-1')
    expect((await guest.waitFor((m) => m.t === 'error')).code).toBe('full')
    guest.send({ t: 'pad', code, device: 'telefon-gosc-1', slot: 1, takeover: true })
    expect((await guest.waitFor((m) => m.t === 'joined')).slot).toBe(1)
    expect(await me.closed).toBe(4002)
    for (const c of [tv, asia, guest, p3, p4]) c.ws.close()
  })

  it('zdarzenia gry mają identyfikator telefonu jako gracza', async () => {
    const tv = connect(port, KEY)
    await tv.opened
    tv.send({ t: 'tv' })
    const code = (await tv.waitFor((m) => m.t === 'joined')).code
    const pad = connect(port, KEY)
    await pad.opened
    pad.send({ t: 'pad', code, device: 'telefon-taty-1' })
    await pad.waitFor((m) => m.t === 'joined')
    pad.send({ t: 'start' })
    for (let i = 0; i < 50 && !gameEvents.some((e) => e.type === 'stage_started'); i += 1) {
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(gameEvents.find((e) => e.type === 'stage_started')).toMatchObject({
      playerIds: ['telefon-taty-1'],
    })
    for (const c of [tv, pad]) c.ws.close()
  })

  it('pad bez telewizora dostaje błąd', async () => {
    const pad = connect(port, KEY)
    await pad.opened
    pad.send({ t: 'pad', code: '0000' })
    await pad.waitFor((m) => m.t === 'error')
    pad.ws.close()
  })
})
