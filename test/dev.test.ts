// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  playerStatsTable,
  setPlayerStatsTable,
  type PlayerLevelStats,
} from '../src/engine/tankStats'
import { createPartyServer, type PartyServerOptions } from '../server/party'

type Msg = { t: string; [k: string]: unknown }

const original = playerStatsTable()
let server: Server | null = null
let close: (() => void) | null = null

afterEach(async () => {
  setPlayerStatsTable(original)
  close?.()
  await new Promise((resolve) => server?.close(resolve))
})

async function start(options: PartyServerOptions) {
  const party = createPartyServer(options)
  close = () => party.close()
  server = createServer((_req, res) => res.writeHead(404).end())
  server.on('upgrade', (req, socket, head) => {
    if (!party.handleUpgrade(req, socket, head)) socket.destroy()
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const ws = new WebSocket(`ws://127.0.0.1:${(server!.address() as AddressInfo).port}/party`)
  const seen: Msg[] = []
  ws.on('message', (d) => seen.push(JSON.parse(d.toString())))
  await new Promise((resolve) => ws.on('open', resolve))
  const send = (action: object) => ws.send(JSON.stringify({ t: 'dev', action }))
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  return { ws, seen, send, wait }
}

describe('tryb developera', () => {
  it('bez włączenia polecenia są ignorowane', async () => {
    const { send, seen, wait, ws } = await start({})
    send({ a: 'stats' })
    send({ a: 'set-stats', stats: [{ bulletLimit: 6 }] })
    await wait(200)
    expect(seen).toHaveLength(0)
    expect(playerStatsTable()[0].bulletLimit).toBe(original[0].bulletLimit)
    ws.close()
  })

  it('zmienia statystyki w locie i zapisuje je', async () => {
    let saved: PlayerLevelStats[] | null = null
    const { send, seen, wait, ws } = await start({
      dev: {
        saveStats: async (s) => {
          saved = s
        },
        loadStats: async () => null,
      },
    })
    send({ a: 'stats' })
    await wait(100)
    expect(seen[0]).toMatchObject({ t: 'dev-stats' })

    const changed = playerStatsTable()
    changed[2].bulletLimit = 5
    send({ a: 'set-stats', stats: changed })
    await wait(100)
    expect(playerStatsTable()[2].bulletLimit).toBe(5)

    send({ a: 'save-stats' })
    await wait(100)
    expect(saved).not.toBeNull()
    expect(saved![2].bulletLimit).toBe(5)
    expect(seen.find((m) => m.t === 'dev-result')).toMatchObject({ ok: true })
    ws.close()
  })
})
