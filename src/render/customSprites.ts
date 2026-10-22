import { Assets, type Texture } from 'pixi.js'
import { MAX_RANK } from '../engine/tankStats'

/**
 * Grafiki z plików PNG (public/grafiki/…, specyfikacja: ZADANIE_grafiki_czolgi_dla_ChatGPT.md).
 * Czego brakuje, rysujemy po staremu z pixel artu w kodzie — gra działa bez żadnych plików.
 */

/** maksymalna liczba klatek, której szukamy dla jednej animacji */
const MAX_FRAMES = 8
/** domyślna prędkość animacji jazdy, gdy manifest.json nic nie mówi */
const DEFAULT_FPS = 12

export interface CustomAnimation {
  frames: Texture[]
  fps: number
}

const playerTanks: (CustomAnimation | null)[] = new Array(MAX_RANK).fill(null)
let loading: Promise<void> | null = null

/** katalog grafik względem strony (gra może stać pod podścieżką, np. /bc/) */
export function assetUrl(path: string): string {
  return `grafiki/${path}`
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' })
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')
  } catch {
    return false
  }
}

/** klatki `<prefix>_1.png`, `<prefix>_2.png`… aż do pierwszej brakującej */
export async function framePaths(prefix: string): Promise<string[]> {
  const paths: string[] = []
  for (let i = 1; i <= MAX_FRAMES; i += 1) {
    const path = `${prefix}_${i}.png`
    if (!(await exists(assetUrl(path)))) break
    paths.push(path)
  }
  return paths
}

export type Manifest = Record<string, { klatki?: number; fps?: number }>

let manifest: Promise<Manifest> | null = null

export function loadManifest(): Promise<Manifest> {
  manifest ??= fetch(assetUrl('manifest.json'), { cache: 'no-cache' })
    .then((res) => (res.ok ? (res.json() as Promise<Manifest>) : {}))
    .catch(() => ({}))
  return manifest
}

async function loadAnimation(prefix: string): Promise<CustomAnimation | null> {
  const paths = await framePaths(prefix)
  if (paths.length === 0) return null
  const frames = await Promise.all(paths.map((p) => Assets.load<Texture>(assetUrl(p))))
  for (const t of frames) t.source.scaleMode = 'nearest'
  const fps = (await loadManifest())[prefix]?.fps ?? DEFAULT_FPS
  return { frames, fps }
}

/** wczytuje wszystko raz na stronę; wywołuj przed pierwszym rysowaniem */
export function loadCustomSprites(): Promise<void> {
  loading ??= (async () => {
    await Promise.all(
      playerTanks.map(async (_, i) => {
        playerTanks[i] = await loadAnimation(`czolgi/gracz/lv${i + 1}/ruch`)
      }),
    )
  })()
  return loading
}

/** animacja czołgu gracza na danym poziomie (1–5) albo null, jeśli nie ma plików */
export function customPlayerTank(rank: number): CustomAnimation | null {
  return playerTanks[rank - 1] ?? null
}
