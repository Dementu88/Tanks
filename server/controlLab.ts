import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { IDLE_INPUT, type PadInput } from '../src/party/controls'
import { parseLabProfile, type LabProfile } from '../src/party/labProfile'

interface Room {
  host: WebSocket | null
  pad: WebSocket | null
  token: string
  profile: LabProfile
  revision: number
  lastInput: number
  idleSince: number
  active: boolean
}
interface Storage {
  load: () => Promise<LabProfile | null>
  save: (profile: LabProfile) => Promise<void>
}
const send = (ws: WebSocket | null, value: unknown) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value))
}
export function parseLabInput(value: unknown): PadInput | null {
  if (value == null || typeof value !== 'object') return null
  const p = value as PadInput
  if (p.direction !== null && !['up', 'down', 'left', 'right'].includes(p.direction)) return null
  if (typeof p.turnOnly !== 'boolean' || typeof p.fire !== 'boolean') return null
  return { direction: p.direction, turnOnly: p.direction != null && p.turnOnly, fire: p.fire }
}

export function createControlLabRelay({
  base = '/',
  storage,
}: {
  base?: string
  storage: Storage
}) {
  const path = `${base.replace(/\/$/, '')}/control-lab`
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 })
  const rooms = new Map<string, Room>()
  const members = new Map<WebSocket, { room: Room; role: 'host' | 'pad' }>()
  const config = (room: Room) =>
    send(room.pad, { t: 'config', profile: room.profile, revision: room.revision })
  const status = (room: Room) => {
    send(room.host, { t: 'status', connected: room.pad != null })
    send(room.pad, { t: 'status', connected: room.host != null })
  }
  const stop = (room: Room) => {
    room.active = false
    send(room.host, { t: 'input', input: IDLE_INPUT })
    room.revision++
    config(room)
  }
  wss.on('connection', (ws) => {
    ws.on('error', () => {})
    const joinTimeout = setTimeout(() => {
      if (!members.has(ws)) ws.close(4000, 'Join timeout')
    }, 5000)
    joinTimeout.unref()
    ws.on('message', (raw) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      const member = members.get(ws)
      if (!member) {
        if (msg.t === 'host' && typeof msg.key === 'string' && /^[a-f0-9]{32}$/.test(msg.key)) {
          const profile = parseLabProfile(msg.profile)
          if (!profile) return
          let room = rooms.get(msg.key)
          if (!room) {
            if (rooms.size >= 16) {
              ws.close(4000, 'Too many rooms')
              return
            }
            room = {
              host: null,
              pad: null,
              token: randomBytes(16).toString('hex'),
              profile,
              revision: 0,
              lastInput: 0,
              idleSince: Date.now(),
              active: false,
            }
            rooms.set(msg.key, room)
          }
          const previous = room.host
          if (previous) {
            members.delete(previous)
            previous.close(4002, 'Host replaced')
          }
          room.host = ws
          room.profile = profile
          members.set(ws, { room, role: 'host' })
          clearTimeout(joinTimeout)
          send(ws, { t: 'joined', token: room.token })
          stop(room)
          status(room)
        } else if (msg.t === 'pad' && typeof msg.token === 'string') {
          const room = [...rooms.values()].find((r) => r.token === msg.token && r.host != null)
          if (!room) {
            ws.close(4004, 'Room not found')
            return
          }
          if (room.pad) {
            ws.close(4002, 'Pad already connected')
            return
          }
          room.pad = ws
          room.lastInput = Date.now()
          members.set(ws, { room, role: 'pad' })
          clearTimeout(joinTimeout)
          stop(room)
          status(room)
        }
        return
      }
      const { room, role } = member
      if (role === 'host') {
        if (msg.t === 'profile') {
          const profile = parseLabProfile(msg.profile)
          if (profile) {
            room.profile = profile
            stop(room)
          }
        } else if (msg.t === 'stop') stop(room)
        else if (msg.t === 'save') {
          const profile = parseLabProfile(msg.profile)
          if (!profile) return
          void storage
            .save(profile)
            .then(() => {
              send(ws, { t: 'saved', profile })
              send(room.pad, { t: 'saved', profile })
            })
            .catch(() =>
              send(ws, { t: 'error', message: 'Nie udało się zapisać profilu na dysku.' }),
            )
        } else if (msg.t === 'load') {
          void storage
            .load()
            .then((profile) => {
              if (!profile) {
                send(ws, { t: 'error', message: 'Nie ma jeszcze zapisanego profilu.' })
                return
              }
              send(ws, { t: 'loaded', profile })
            })
            .catch(() => send(ws, { t: 'error', message: 'Nie udało się wczytać profilu.' }))
        }
      } else if (msg.t === 'input' && room.host && msg.revision === room.revision) {
        const input = parseLabInput(msg.input)
        if (!input) return
        room.lastInput = Date.now()
        room.active = input.direction != null || input.fire
        const sample = msg.sample as {
          x?: number
          y?: number
          distance?: number
          event?: string
        } | null
        const validSample =
          sample &&
          [sample.x, sample.y, sample.distance].every(
            (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100,
          )
        send(room.host, {
          t: 'input',
          input,
          sample: validSample
            ? {
                x: sample.x,
                y: sample.y,
                distance: sample.distance,
                event: 'telefon',
                state: input,
              }
            : null,
        })
      }
    })
    ws.on('close', () => {
      clearTimeout(joinTimeout)
      const member = members.get(ws)
      members.delete(ws)
      if (!member) return
      const { room, role } = member
      room[role] = null
      room.idleSince = Date.now()
      stop(room)
      status(room)
    })
  })
  const watchdog = setInterval(() => {
    for (const [key, room] of rooms) {
      if (room.pad && Date.now() - room.lastInput > (room.active ? 800 : 3000)) {
        stop(room)
        const pad = room.pad
        // Zamrożona karta nie może nadal zajmować połączenia i wznowić starego ruchu.
        pad?.terminate()
      }
      if (!room.host && !room.pad && Date.now() - room.idleSince > 300000) rooms.delete(key)
    }
  }, 200)
  watchdog.unref()
  return {
    handleRequest(req: IncomingMessage, res: ServerResponse): boolean {
      if (new URL(req.url ?? '/', 'http://localhost').pathname !== `${path}/addresses`) return false
      const addresses = Object.entries(networkInterfaces())
        .flatMap(([name, list]) =>
          (list ?? [])
            .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
            .map((i) => ({
              address: i.address,
              virtual: /vethernet|wsl|docker|vmware|virtualbox/i.test(name),
            })),
        )
        .sort((a, b) => Number(a.virtual) - Number(b.virtual))
        .map((i) => i.address)
      res
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ addresses }))
      return true
    },
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      if (new URL(req.url ?? '/', 'http://localhost').pathname !== path) return false
      if (wss.clients.size >= 40) {
        socket.destroy()
        return true
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
      return true
    },
    close() {
      clearInterval(watchdog)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}
