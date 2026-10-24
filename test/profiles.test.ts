import { describe, expect, it } from 'vitest'
import {
  Profiles,
  configuredProfiles,
  type ProfileFile,
  type ProfileStore,
} from '../server/profiles'
import type { GameEvent } from '../src/engine/events'
import { DEFAULT_XP_CONFIG } from '../src/engine/sessionXp'

const kill: GameEvent = {
  type: 'bot_killed',
  time: 0,
  playerId: 'p1',
  level: 'armor',
  score: 0,
  by: 'bullet',
}

function memoryStore(initial: ProfileFile | null = null) {
  let data = initial
  const store: ProfileStore & { data: () => ProfileFile | null } = {
    load: async () => (data == null ? null : JSON.parse(JSON.stringify(data))),
    save: async (d) => {
      data = JSON.parse(JSON.stringify(d))
    },
    data: () => data,
  }
  return store
}

describe('profile drużyny', () => {
  it('pierwszy profil z configu to TankMonsters, a XP jest domyślnie włączone', () => {
    expect(configuredProfiles()[0]).toBe('TankMonsters')
    expect(DEFAULT_XP_CONFIG.enabled).toBe(true)
  })

  it('każdy profil ma własne XP i rekord; wybór w lewo / prawo chodzi w kółko', async () => {
    const profiles = new Profiles(['TankMonsters', 'Dzieciaki'], null)
    await profiles.ready
    profiles.xp.record(kill)
    expect(profiles.reached('classic', 4)).toBe(true)
    expect(profiles.reached('classic', 2)).toBe(false)
    const bank = profiles.xp.snapshot().bank
    expect(bank).toBeGreaterThan(0)
    expect(profiles.step(1)).toBe('Dzieciaki')
    expect(profiles.xp.snapshot().bank).toBe(0)
    expect(profiles.record.classic).toBe(0)
    expect(profiles.step(1)).toBe('TankMonsters')
    expect(profiles.step(-1)).toBe('Dzieciaki')
    profiles.step(-1)
    expect(profiles.xp.snapshot().bank).toBe(bank)
    expect(profiles.record).toEqual({ classic: 4, random: 0, wide: 0 })
  })

  it('postęp zapisuje się sam i wczytuje po ponownym uruchomieniu serwera', async () => {
    const store = memoryStore()
    const first = new Profiles(['TankMonsters'], store, 10)
    await first.ready
    first.xp.configure({ ...DEFAULT_XP_CONFIG, costs: { ...DEFAULT_XP_CONFIG.costs, speed: 1 } })
    first.xp.record(kill)
    expect(first.xp.buy('speed')).toBe(true)
    first.reached('wide', 7)
    first.changed()
    await new Promise((r) => setTimeout(r, 40))
    expect(store.data()?.profiles.TankMonsters.record.wide).toBe(7)

    const again = new Profiles(['TankMonsters'], store)
    await again.ready
    expect(again.xp.snapshot().levels.speed).toBe(1)
    expect(again.xp.snapshot().bank).toBe(first.xp.snapshot().bank)
    expect(again.xp.snapshot().config.costs.speed).toBe(1)
    expect(again.record.wide).toBe(7)
  })

  it('profil z pliku, którego nie ma w configu, nie znika', async () => {
    const store = memoryStore({
      version: 1,
      profiles: {
        Stary: {
          xp: { ...new Profiles(['x'], null).xp.snapshot(), bank: 55 },
          record: { classic: 2, random: 0, wide: 0 },
          updatedAt: '',
        },
      },
    })
    const profiles = new Profiles(['TankMonsters'], store)
    await profiles.ready
    expect(profiles.names).toEqual(['TankMonsters', 'Stary'])
    profiles.step(1)
    expect(profiles.xp.snapshot().bank).toBe(55)
  })
})

describe('profile w serwerze gry', () => {
  it('ekran przełącza profil w lobby, a plansze z gry wczytują rekord profilu', async () => {
    const { createServer } = await import('node:http')
    const { WebSocket } = await import('ws')
    const { createPartyServer } = await import('../server/party')
    const profiles = new Profiles(['TankMonsters', 'Dzieciaki'], null)
    await profiles.ready
    profiles.step(1)
    profiles.reached('classic', 5)
    profiles.step(-1)
    const party = createPartyServer({ profiles })
    const server = createServer((_q, r) => r.writeHead(404).end())
    server.on('upgrade', (req, socket, head) => {
      if (!party.handleUpgrade(req, socket, head)) socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/party`)
    const rooms: { profile?: { name: string }; stageIndex: number }[] = []
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      if (m.t === 'room') rooms.push(m.room)
    })
    await new Promise<void>((r) => ws.on('open', () => r()))
    const wait = async (pred: () => boolean) => {
      for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 20))
      expect(pred()).toBe(true)
    }
    try {
      ws.send(JSON.stringify({ t: 'tv' }))
      await wait(() => rooms.length > 0)
      expect(rooms[rooms.length - 1].profile!.name).toBe('TankMonsters')
      ws.send(JSON.stringify({ t: 'profile', delta: 1 }))
      await wait(() => rooms[rooms.length - 1].profile!.name === 'Dzieciaki')
      expect(rooms[rooms.length - 1].stageIndex).toBe(5)
    } finally {
      ws.terminate()
      party.close()
      await new Promise((r) => server.close(r))
    }
  })
})
