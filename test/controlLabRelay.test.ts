// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
import { WebSocket } from 'ws'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createControlLabRelay } from '../server/controlLab'
import { controlLabStorage } from '../server/controlLabStorage'
import { DEFAULT_PROFILE } from '../src/party/labProfile'
import { STABLE_STICK } from '../src/party/stick'

type Message = { t: string; [key: string]: any }
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let server: Server
let relay: ReturnType<typeof createControlLabRelay>
let directory: string
let port: number
function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/control-lab`)
  const messages: Message[] = []
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
  ws.on('error', () => {})
  const opened = new Promise<void>((resolve) => ws.once('open', resolve))
  const closed = new Promise<number>((resolve) => ws.once('close', resolve))
  const send = (value: unknown) => ws.send(JSON.stringify(value))
  const take = async (type: string, predicate = (_msg: Message) => true) => {
    for (let i = 0; i < 200; i++) {
      const index = messages.findIndex((msg) => msg.t === type && predicate(msg))
      if (index >= 0) return messages.splice(index, 1)[0]
      await delay(10)
    }
    throw new Error(`Brak wiadomości ${type}`)
  }
  return { ws, messages, opened, closed, send, take }
}
async function pair(key = 'a'.repeat(32)) {
  const host = client()
  await host.opened
  host.send({ t: 'host', key, profile: DEFAULT_PROFILE })
  const joined = await host.take('joined')
  const pad = client()
  await pad.opened
  pad.send({ t: 'pad', token: joined.token })
  const config = await pad.take('config')
  await host.take('status', (msg) => msg.connected)
  return { host, pad, revision: config.revision, token: joined.token }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'zombietanks-lab-'))
  relay = createControlLabRelay({ storage: controlLabStorage(join(directory, 'sterowanie.json')) })
  server = createServer((req, res) => {
    if (!relay.handleRequest(req, res)) res.writeHead(404).end()
  })
  server.on('upgrade', (req, socket, head) => {
    if (!relay.handleUpgrade(req, socket, head)) socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})
afterEach(async () => {
  relay.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  // mkdtemp zwraca katalog tego testu; nie dotykamy konfiguracji użytkownika.
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('zombietanks-lab-')
  )
    throw new Error('Nieprawidłowy katalog testu')
  await rm(directory, { recursive: true, force: true })
})

describe('telefon jako pad poligonu', () => {
  it('przekazuje ruch, rozsyła suwaki i odrzuca wejście ze starego profilu', async () => {
    const { host, pad, revision } = await pair()
    const input = { direction: 'right', turnOnly: false, fire: true }
    pad.send({ t: 'input', input, revision })
    expect((await host.take('input', (msg) => msg.input.direction === 'right')).input).toEqual(
      input,
    )
    const profile = {
      ...DEFAULT_PROFILE,
      stick: STABLE_STICK,
      stickSize: 700,
    }
    host.send({ t: 'profile', profile })
    const config = await pad.take('config')
    expect(config.profile).toEqual(profile)
    expect(config.revision).toBeGreaterThan(revision)
    host.messages.length = 0
    pad.send({ t: 'input', input, revision })
    await delay(40)
    expect(host.messages.some((msg) => msg.t === 'input' && msg.input.direction === 'right')).toBe(
      false,
    )
    pad.send({ t: 'input', input, revision: config.revision })
    await host.take('input', (msg) => msg.input.direction === 'right')
  })
  it('zatrzymuje po rozłączeniu i po braku świeżych danych', async () => {
    const { host, pad, revision } = await pair()
    host.messages.length = 0
    pad.send({ t: 'input', revision, input: { direction: 'left', turnOnly: false, fire: false } })
    await host.take('input', (msg) => msg.input.direction === 'left')
    await host.take('input', (msg) => msg.input.direction === null)
    await pad.closed
    await host.take('status', (msg) => !msg.connected)
  })
  it('zapisuje na dysku tylko po Zapisz i potrafi wczytać profil', async () => {
    const { host, pad } = await pair()
    const profile = {
      ...DEFAULT_PROFILE,
      stick: STABLE_STICK,
      fireSize: 160,
    }
    host.send({ t: 'profile', profile })
    await pad.take('config')
    await expect(readFile(join(directory, 'sterowanie.json'), 'utf8')).rejects.toThrow()
    pad.send({ t: 'save', profile })
    await delay(40)
    await expect(readFile(join(directory, 'sterowanie.json'), 'utf8')).rejects.toThrow()
    host.send({ t: 'save', profile })
    expect((await host.take('saved')).profile).toEqual(profile)
    expect((await pad.take('saved')).profile).toEqual(profile)
    expect(JSON.parse(await readFile(join(directory, 'sterowanie.json'), 'utf8'))).toEqual(profile)
    host.send({ t: 'load' })
    expect((await host.take('loaded')).profile).toEqual(profile)
  })
  it('izoluje sesje i odmawia drugiemu telefonowi przejęcia pada', async () => {
    const a = await pair('a'.repeat(32))
    const b = await pair('b'.repeat(32))
    a.host.messages.length = 0
    b.host.messages.length = 0
    a.pad.send({
      t: 'input',
      revision: a.revision,
      input: { direction: 'up', turnOnly: false, fire: false },
    })
    await a.host.take('input', (msg) => msg.input.direction === 'up')
    expect(b.host.messages.some((msg) => msg.t === 'input')).toBe(false)
    const extra = client()
    await extra.opened
    extra.send({ t: 'pad', token: a.token })
    expect(await extra.closed).toBe(4002)
    a.pad.ws.close()
    await a.host.take('status', (msg) => !msg.connected)
  })
  it('odrzuca nieprawidłowy profil bez zmiany stanu telefonu', async () => {
    const { host, pad } = await pair()
    host.send({ t: 'profile', profile: { ...DEFAULT_PROFILE, stickSize: 999999 } })
    host.send({
      t: 'save',
      profile: { ...DEFAULT_PROFILE, stick: { ...STABLE_STICK, sensitivity: null } },
    })
    await delay(60)
    expect(pad.messages.some((msg) => msg.t === 'config')).toBe(false)
    await expect(readFile(join(directory, 'sterowanie.json'), 'utf8')).rejects.toThrow()
  })
})
