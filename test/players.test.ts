import { describe, expect, it } from 'vitest'
import {
  configuredPlayers,
  LOGO_IDS,
  PlayerBook,
  type PlayersFile,
  type PlayersStore,
} from '../server/players'
import { GAMEPLAY } from '../src/engine/gameplayConfig'

const defs = [
  { id: 'kapitan', name: 'Kapitan', logo: 'gwiazda' },
  { id: 'snajper', name: 'Snajper', logo: 'celownik' },
]

function memoryStore(initial: PlayersFile | null = null) {
  let data = initial
  const store: PlayersStore & { data: () => PlayersFile | null } = {
    load: async () => (data == null ? null : JSON.parse(JSON.stringify(data))),
    save: async (d) => {
      data = JSON.parse(JSON.stringify(d))
    },
    data: () => data,
  }
  return store
}

describe('profile graczy', () => {
  it('config ma graczy z poprawnym logo z config/loga.json', () => {
    const players = configuredPlayers()
    expect(players.length).toBeGreaterThan(0)
    for (const p of players) expect(LOGO_IDS).toContain(p.logo)
  })

  it('zdarzenia gry zwiększają statystyki tylko graczy z profilem', async () => {
    const book = new PlayerBook(defs, null)
    await book.ready
    book.gameStarted(['kapitan'], 1000)
    book.record({
      type: 'stage_started',
      stageName: '1',
      stageNumber: 3,
      playerIds: ['kapitan', 'telefon-x'],
    })
    book.record({ type: 'shot', time: 0, playerId: 'kapitan' })
    book.record({ type: 'bot_hit', time: 0, playerId: 'kapitan', level: 'armor', killed: false })
    book.record({
      type: 'bot_killed',
      time: 0,
      playerId: 'kapitan',
      level: 'armor',
      score: 400,
      by: 'bullet',
    })
    book.record({
      type: 'bot_killed',
      time: 0,
      playerId: 'kapitan',
      level: 'basic',
      score: 0,
      by: 'grenade',
    })
    book.record({ type: 'player_died', time: 0, playerId: 'kapitan', killerLevel: 'fast' })
    book.record({ type: 'powerup_picked', time: 0, playerId: 'kapitan', name: 'star' })
    book.record({
      type: 'stage_cleared',
      stageName: '1',
      stageNumber: 3,
      duration: 1000,
      players: [
        { playerId: 'kapitan', score: 700, kills: { basic: 1, fast: 0, power: 0, armor: 1 } },
      ],
    })
    book.gameEnded(61000)
    const s = book.statsOf('kapitan')!
    expect(s).toMatchObject({
      games: 1,
      stagesPlayed: 1,
      stagesCleared: 1,
      bestStage: 3,
      shots: 1,
      hits: 1,
      deaths: 1,
      powerups: 1,
      grenadeKills: 1,
      score: 700,
      playTimeMs: 60000,
      level: 0,
      // XP gracza za wrogów (pancerny + zwykły z granatu), jak w config/rozgrywka.json
      xp: GAMEPLAY.xpKillRewards.armor + GAMEPLAY.xpKillRewards.basic,
    })
    expect(s.kills).toEqual({ basic: 1, fast: 0, power: 0, armor: 1 })
    expect(book.statsOf('snajper')!.games).toBe(0)
    expect(book.statsOf('telefon-x')).toBeUndefined()
  })

  it('zapis z opóźnieniem i wczytanie po restarcie; logo z gry ma pierwszeństwo', async () => {
    const store = memoryStore()
    const book = new PlayerBook(defs, store, 10)
    await book.ready
    book.record({ type: 'shot', time: 0, playerId: 'snajper' })
    expect(book.setLogo('snajper', 'korona')).toBe(true)
    expect(book.setLogo('snajper', 'nie-ma')).toBe(false)
    await new Promise((r) => setTimeout(r, 40))
    expect(store.data()?.players.snajper.shots).toBe(1)

    const again = new PlayerBook(defs, store)
    await again.ready
    expect(again.statsOf('snajper')!.shots).toBe(1)
    expect(again.logoOf('snajper')).toBe('korona')
    expect(again.logoOf('kapitan')).toBe('gwiazda')
  })

  it('usunięty z configu gracz nie znika z pliku danych', async () => {
    const store = memoryStore()
    const full = new PlayerBook(defs, store, 10)
    await full.ready
    full.record({ type: 'shot', time: 0, playerId: 'snajper' })
    await full.flush()
    const reduced = new PlayerBook([defs[0]], store)
    await reduced.ready
    await reduced.flush()
    expect(store.data()?.players.snajper.shots).toBe(1)
  })
})

describe('profile graczy w serwerze', () => {
  it('pad wybiera profil, drugi pad nie może wziąć tego samego', async () => {
    const { createServer } = await import('node:http')
    const { WebSocket } = await import('ws')
    const { createPartyServer } = await import('../server/party')
    const party = createPartyServer({ players: new PlayerBook(defs, null) })
    const server = createServer((_q, r) => r.writeHead(404).end())
    server.on('upgrade', (req, socket, head) => {
      if (!party.handleUpgrade(req, socket, head)) socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    type Room = { code: string; padPlayers?: (string | null)[] }
    const open = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/party`)
      const rooms: Room[] = []
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString())
        if (m.t === 'room') rooms.push(m.room)
      })
      await new Promise<void>((r) => ws.on('open', () => r()))
      return {
        ws,
        last: () => rooms[rooms.length - 1],
        send: (m: object) => ws.send(JSON.stringify(m)),
      }
    }
    const wait = async (pred: () => boolean) => {
      for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 20))
      expect(pred()).toBe(true)
    }
    const tv = await open()
    const a = await open()
    const b = await open()
    try {
      tv.send({ t: 'tv' })
      await wait(() => tv.last() != null)
      const code = tv.last().code
      a.send({ t: 'pad', code, device: 'aaaa-1' })
      b.send({ t: 'pad', code, device: 'bbbb-1' })
      await wait(() => (tv.last().padPlayers ?? []).length === 4)
      a.send({ t: 'player', id: 'kapitan' })
      await wait(() => tv.last().padPlayers?.[0] === 'kapitan')
      b.send({ t: 'player', id: 'kapitan' })
      b.send({ t: 'player', id: 'snajper' })
      await wait(() => tv.last().padPlayers?.[1] === 'snajper')
      expect(tv.last().padPlayers?.[0]).toBe('kapitan')
    } finally {
      for (const c of [tv, a, b]) c.ws.terminate()
      party.close()
      await new Promise((r) => server.close(r))
    }
  })
})

describe('stopnie graczy w grze', () => {
  it('XP za wrogów rośnie i przy progu ogłasza awans', async () => {
    const { FIRST_PROMOTION_XP } = await import('../src/party/ranks')
    const { GAMEPLAY } = await import('../src/engine/gameplayConfig')
    const book = new PlayerBook(defs, null)
    await book.ready
    const promotions: [string, number][] = []
    book.onPromotion = (id, rank) => promotions.push([id, rank])
    const kills = Math.ceil(FIRST_PROMOTION_XP / GAMEPLAY.xpKillRewards.armor)
    for (let i = 0; i < kills; i++)
      book.record({
        type: 'bot_killed',
        time: 0,
        playerId: 'kapitan',
        level: 'armor',
        score: 0,
        by: 'bullet',
      })
    expect(book.statsOf('kapitan')!.xp).toBe(kills * GAMEPLAY.xpKillRewards.armor)
    expect(book.statsOf('kapitan')!.level).toBe(1)
    expect(promotions).toEqual([['kapitan', 1]])
  })
})
