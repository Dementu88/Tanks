import { BLOCK_SIZE, FIELD_BLOCK_SIZE, eagleCol, playerSpawns } from '../constants'
import type { RawStageConfig } from '../types'

/**
 * Losowa plansza 13 wierszy × cols kolumn (13 = jak oryginał, 21 = szeroka) w formacie plansz
 * z gry (RawStageConfig). Symetryczna (lewa połowa odbita na prawą), z twierdzą orła jak
 * w oryginale, wolnymi miejscami startu i sprawdzeniem, że z każdego startu da się dojechać
 * do orła (cegły się nie liczą — można je rozstrzelać).
 */

const ROWS = FIELD_BLOCK_SIZE

/** twierdza orła — te same cegły co w planszach oryginału (kolumny względem orła) */
function fort(cols: number): Record<string, string> {
  const e = eagleCol(cols)
  return {
    [`11,${e - 1}`]: 'B8',
    [`11,${e}`]: 'Bc',
    [`11,${e + 1}`]: 'B4',
    [`12,${e - 1}`]: 'Ba',
    [`12,${e}`]: 'E',
    [`12,${e + 1}`]: 'B5',
  }
}

/** wjazdy wrogów (góra) i starty graczy (dół) — jak w BOT_SPAWN_X / playerSpawns */
function startCells(cols: number): { bots: number[]; players: number[] } {
  const e = eagleCol(cols)
  const bots =
    cols > FIELD_BLOCK_SIZE
      ? [e, cols - 1, 0, Math.floor(e / 2), cols - 1 - Math.floor(e / 2)]
      : [e, cols - 1, 0]
  return { bots, players: playerSpawns(cols).map((p) => p.x / BLOCK_SIZE) }
}

/** starty i kratka przed nimi — zawsze puste */
function reserved(cols: number): Set<string> {
  const { bots, players } = startCells(cols)
  return new Set([
    ...bots.flatMap((c) => [`0,${c}`, `1,${c}`]),
    ...players.flatMap((c) => [`12,${c}`, `11,${c}`]),
  ])
}

type Pattern = { token: () => string; weight: number }

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

function weighted(patterns: Pattern[], random: () => number): Pattern {
  const total = patterns.reduce((s, p) => s + p.weight, 0)
  let r = random() * total
  for (const p of patterns) {
    r -= p.weight
    if (r < 0) return p
  }
  return patterns[patterns.length - 1]
}

/**
 * odbicie lewo–prawo częściowej cegły / stali: krótki zapis to 4 ćwiartki
 * (1 lewa-góra, 2 prawa-góra, 4 lewa-dół, 8 prawa-dół) — zamieniamy lewe z prawymi
 */
export function mirrorToken(token: string): string {
  const m = /^([BT])([0-9a-f])$/i.exec(token)
  if (m == null) return token
  const v = parseInt(m[2], 16)
  const flipped = ((v & 1) << 1) | ((v & 2) >> 1) | ((v & 4) << 1) | ((v & 8) >> 1)
  return `${m[1]}${flipped.toString(16)}`
}

/** czy z każdego startu da się dojechać przed orła; stal i woda blokują, reszta nie */
function passable(grid: string[][], cols: number): boolean {
  const free = (r: number, c: number) => {
    const t = grid[r][c][0]
    return t !== 'T' && t !== 'R'
  }
  const FORT = fort(cols)
  const target = `10,${eagleCol(cols)}`
  const { bots, players } = startCells(cols)
  const starts = [...bots.map((c) => `0,${c}`), ...players.map((c) => `12,${c}`)]
  for (const start of starts) {
    const seen = new Set([start])
    const queue = [start]
    let ok = false
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (cur === target) {
        ok = true
        break
      }
      const [r, c] = cur.split(',').map(Number)
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nr = r + dr
        const nc = c + dc
        const key = `${nr},${nc}`
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= cols || seen.has(key) || !free(nr, nc)) {
          continue
        }
        if (FORT[key] != null && key !== target) continue
        seen.add(key)
        queue.push(key)
      }
    }
    if (!ok) return false
  }
  return true
}

/** skład wrogów rośnie z numerem planszy: coraz mniej zwykłych, coraz więcej pancernych */
export function randomBots(stageNumber: number, random: () => number): string[] {
  const n = Math.max(1, stageNumber)
  const armor = Math.min(6, Math.floor(n / 4) + (random() < 0.3 ? 1 : 0))
  const power = Math.min(7, Math.floor(n / 3))
  const fast = Math.min(6, 1 + Math.floor(n / 2))
  const basic = Math.max(1, 20 - armor - power - fast)
  return [
    `${basic}*basic`,
    fast > 0 ? `${fast}*fast` : null,
    power > 0 ? `${power}*power` : null,
    armor > 0 ? `${armor}*armor` : null,
  ].filter((g): g is string => g != null)
}

export function randomStage(
  name: string,
  stageNumber: number,
  random: () => number,
  cols: number = FIELD_BLOCK_SIZE,
): RawStageConfig {
  const MID = Math.floor(cols / 2)
  const N = ROWS
  // szeroka plansza: proporcjonalnie więcej „pędzli”
  const extra = cols / FIELD_BLOCK_SIZE
  const patterns: Pattern[] = [
    { token: () => (random() < 0.8 ? 'Bf' : pick(['B3', 'Bc', 'Ba', 'B5'], random)), weight: 55 },
    {
      token: () => (random() < 0.6 ? 'Tf' : pick(['T3', 'Tc'], random)),
      weight: 8 + Math.min(8, stageNumber / 3),
    },
    { token: () => 'R', weight: 6 },
    { token: () => 'F', weight: 16 },
    { token: () => 'S', weight: 7 },
  ]
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const grid = Array.from({ length: N }, () => new Array<string>(cols).fill('X'))
    // kilka „pędzli”: pionowe / poziome odcinki i bloki 2×2 w lewej połowie
    const strokes = Math.round((9 + Math.floor(random() * 6)) * extra)
    for (let s = 0; s < strokes; s += 1) {
      const p = weighted(patterns, random)
      const kind = random()
      const r0 = Math.floor(random() * (N - 1))
      const c0 = Math.floor(random() * (MID + 1))
      const cells: [number, number][] = []
      if (kind < 0.45) {
        const len = 2 + Math.floor(random() * 4)
        for (let i = 0; i < len; i += 1) cells.push([r0 + i, c0])
      } else if (kind < 0.8) {
        const len = 2 + Math.floor(random() * 3)
        for (let i = 0; i < len; i += 1) cells.push([r0, c0 + i])
      } else {
        cells.push([r0, c0], [r0 + 1, c0], [r0, c0 + 1], [r0 + 1, c0 + 1])
      }
      for (const [r, c] of cells) {
        if (r >= N || c > MID) continue
        grid[r][c] = p.token()
      }
    }
    // lustro: prawa połowa = odbicie lewej
    for (let r = 0; r < N; r += 1) {
      for (let c = 0; c < MID; c += 1) grid[r][cols - 1 - c] = mirrorToken(grid[r][c])
    }
    for (const key of reserved(cols)) {
      const [r, c] = key.split(',').map(Number)
      grid[r][c] = 'X'
    }
    for (const [key, token] of Object.entries(fort(cols))) {
      const [r, c] = key.split(',').map(Number)
      grid[r][c] = token
    }
    if (!passable(grid, cols)) continue
    return {
      name,
      difficulty: Math.min(4, 1 + Math.floor(stageNumber / 9)) as 1 | 2 | 3 | 4,
      map: grid.map((row) => row.map((t) => t.padEnd(3)).join('')),
      bots: randomBots(stageNumber, random),
    }
  }
  throw new Error('Nie udało się wylosować przejezdnej planszy')
}

/** cała „kampania” losowych plansz (numery R1, R2…; szerokie W1, W2…) */
export function randomCampaign(
  count: number,
  random: () => number,
  cols: number = FIELD_BLOCK_SIZE,
): RawStageConfig[] {
  const prefix = cols > FIELD_BLOCK_SIZE ? 'W' : 'R'
  return Array.from({ length: count }, (_, i) =>
    randomStage(`${prefix}${i + 1}`, i + 1, random, cols),
  )
}
