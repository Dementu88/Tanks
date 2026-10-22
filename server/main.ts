import { createReadStream, readFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setPlayerStatsTable, type PlayerLevelStats } from '../src/engine/tankStats'
import { createPartyServer } from './party'
import { GAMEPLAY } from '../src/engine/gameplayConfig'
import { DEFAULT_XP_CONFIG } from '../src/engine/sessionXp'
import { createControlLabRelay } from './controlLab'
import { controlLabStorage } from './controlLabStorage'

/**
 * Serwer dla rodzinki: statyczna gra z www/ i tryb party (/party). Stary tryb LAN z oryginału
 * jest celowo wyłączony — to tylko dodatkowa furtka bez klucza.
 *   PORT=8091 PARTY_KEY=… node dist-server/main.js
 * Bez PARTY_KEY każdy, kto zna adres, może grać — tak tylko lokalnie w domu.
 */
const ROOT = fileURLToPath(new URL('../www/', import.meta.url))
/** public/ w projekcie — w trybie developera grafiki idą prosto stąd, bez przebudowy */
const PUBLIC_ROOT = fileURLToPath(new URL('../public/', import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
}

function parsePort(argv: string[]): number {
  const i = argv.findIndex((a) => a === '--port' || a === '-p')
  const raw = i !== -1 ? argv[i + 1] : process.env.PORT
  const port = Number(raw ?? 8080)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error('Port musi być liczbą 1–65535')
    process.exit(1)
  }
  return port
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end()
    return
  }
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  // krótkie adresy do wpisania pilotem w telewizorze
  if (pathname === '/tv') {
    // względnie, żeby działało też za nginxem pod podścieżką
    res.writeHead(302, { location: './#/tv' }).end()
    return
  }
  const fromPublic = devMode && pathname.startsWith('/grafiki/')
  const root = fromPublic ? PUBLIC_ROOT : ROOT
  const file = normalize(join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname))
  if (!file.startsWith(root)) {
    res.writeHead(403).end()
    return
  }
  const info = await stat(file).catch(() => null)
  if (info == null || !info.isFile()) {
    res.writeHead(404).end('Not Found')
    return
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'content-length': info.size,
    // index.html zawsze świeży, assety mają hash w nazwie
    // grafiki w trybie developera się zmieniają — bez cache; assety z hashem w nazwie na zawsze
    'cache-control':
      file.endsWith('.html') || fromPublic ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  createReadStream(file).pipe(res)
}

if (process.argv.includes('--check-config')) {
  console.log(
    `[konfiguracja] LV start ${GAMEPLAY.playerStartRank}, XP max ${GAMEPLAY.xpMaxLevel}, XP ${DEFAULT_XP_CONFIG.enabled ? 'ON' : 'OFF'}, tarcza wroga ${GAMEPLAY.enemySpawnShieldMs / 1000} s`,
  )
  console.log(
    '[konfiguracja] XP za wroga:',
    GAMEPLAY.xpKillRewards,
    'Koszty LV1:',
    DEFAULT_XP_CONFIG.costs,
  )
  process.exit(0)
}
const port = parsePort(process.argv.slice(2))
const key = process.env.PARTY_KEY?.trim() || null
/** tryb developera: lokalnie (bez klucza) albo wymuszony PARTY_DEV=1; nigdy na serwerze z kluczem */
const devMode = process.env.PARTY_DEV === '1' || key == null

/** config/czolgi.json obok dist-server/ — edytowany w trybie developera (#/dev) */
const STATS_FILE = fileURLToPath(new URL('../config/czolgi.json', import.meta.url))

async function loadStatsFile(): Promise<PlayerLevelStats[] | null> {
  try {
    const json = JSON.parse(await readFile(STATS_FILE, 'utf8'))
    return Array.isArray(json?.gracz) ? json.gracz : null
  } catch {
    return null
  }
}

async function saveStatsFile(stats: PlayerLevelStats[]): Promise<void> {
  let opis = ''
  try {
    opis = JSON.parse(await readFile(STATS_FILE, 'utf8'))?.opis ?? ''
  } catch {
    // pliku jeszcze nie ma
  }
  const rows = stats.map((row) => `    ${JSON.stringify(row)}`).join(',\n')
  await mkdir(fileURLToPath(new URL('../config/', import.meta.url)), { recursive: true })
  await writeFile(
    STATS_FILE,
    `{\n  "opis": ${JSON.stringify(opis)},\n  "gracz": [\n${rows}\n  ]\n}\n`,
  )
}

// plik z dysku ma pierwszeństwo przed wartościami wbudowanymi przy budowaniu
// (synchronicznie: przy starcie, zanim ktokolwiek zacznie grę)
try {
  const json = JSON.parse(readFileSync(STATS_FILE, 'utf8'))
  if (Array.isArray(json?.gracz)) setPlayerStatsTable(json.gracz)
} catch {
  // brak pliku — zostają wartości wbudowane
}
const party = createPartyServer({
  key,
  dev: devMode ? { saveStats: saveStatsFile, loadStats: loadStatsFile } : undefined,
  // na razie tylko dziennik (journalctl); profile i osiągnięcia podepną się w tym miejscu
  onGameEvent: (event) => {
    if (
      event.type === 'stage_started' ||
      event.type === 'stage_cleared' ||
      event.type === 'game_over' ||
      event.type === 'game_cleared'
    ) {
      console.log(`[gra] ${JSON.stringify(event)}`)
    }
  },
})

/**
 * adresy tego komputera w sieci domowej — TV otwarte jako localhost pokazuje w QR adres, pod
 * którym telefony w tym samym Wi-Fi go znajdą. Tylko lokalnie (bez klucza): na serwerze publicznym
 * nie zdradzamy wewnętrznych adresów.
 */
function lanAddresses(): string[] {
  // Wi-Fi domowe zwykle 192.168.x; karty wirtualne (WSL, Hyper-V, Docker, VirtualBox) na sam koniec —
  // telefon ich nie widzi; 172.x bez wirtualnej nazwy to np. hotspot z iPhone'a (172.20.10.x)
  const virtual = /vethernet|wsl|hyper-v|docker|virtualbox|vmware|vbox|loopback/i
  const rank = (name: string, ip: string) =>
    virtual.test(name)
      ? 9
      : ip.startsWith('192.168.')
        ? 0
        : ip.startsWith('10.')
          ? 1
          : ip.startsWith('172.')
            ? 2
            : 3
  return Object.entries(networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).map((i) => ({ name, ...i })))
    .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .sort((a, b) => rank(a.name, a.address) - rank(b.name, b.address))
    .map((i) => i.address)
}

const lab =
  key == null
    ? createControlLabRelay({
        storage: controlLabStorage(
          fileURLToPath(new URL('../config/sterowanie.json', import.meta.url)),
        ),
      })
    : null

const server = createServer((req, res) => {
  if (lab?.handleRequest(req, res)) return
  if (devMode && new URL(req.url ?? '/', 'http://localhost').pathname === '/party/lan') {
    const body = JSON.stringify({ adresy: lanAddresses(), port })
    res
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(body)
    return
  }
  serveStatic(req, res).catch(() => res.writeHead(500).end())
})
server.on('upgrade', (req, socket, head) => {
  if (lab?.handleUpgrade(req, socket, head)) return
  if (party.handleUpgrade(req, socket, head)) return
  socket.destroy()
})
server.on('close', () => lab?.close())
server.listen(port, '::', () => {
  const link = `http://localhost:${port}/#/tv${key == null ? '' : '?k=<PARTY_KEY>'}`
  console.log(`Battle City party: ${link}  (telefony skanują kod QR z TV)`)
  if (key == null) console.warn('UWAGA: brak PARTY_KEY — gra otwarta dla każdego, kto zna adres')
})

const shutdown = () => {
  party.close()
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
