import { isRoomCode } from '../party/protocol'
import { useSyncExternalStore } from 'react'

/** 与原版一致：双人模式用 `?multi-players` 标记，在 choose / stage / gameover 之间透传 */
export const MULTI_PLAYERS_SEARCH = '?multi-players'

export type StageListTab = 'default' | 'custom'
export type EditorView = 'config' | 'map'
/** 联机外壳：房间列表 / 创建房间 / 房间等待页（对战也在房间页里进行） */
export type LobbyView = 'list' | 'create' | 'room'

export const GALLERY_TABS = [
  'tanks',
  'texts',
  'fire',
  'misc',
  'title-scene',
  'statistics',
  'gameover',
  'info',
] as const
export type GalleryTab = (typeof GALLERY_TABS)[number]

export type Route =
  | { screen: 'title' }
  | { screen: 'choose'; stageName: string | null; multi: boolean }
  | { screen: 'battle'; stageName: string | null; multi: boolean }
  | { screen: 'gameover'; multi: boolean }
  | { screen: 'stage-list'; tab: StageListTab | null; page: number | null }
  | { screen: 'editor'; view: EditorView | null }
  | { screen: 'gallery'; tab: GalleryTab | null }
  | { screen: 'options' }
  | { screen: 'lobby'; view: LobbyView }
  /** tryb party: telewizor jako ekran (#/tv, #/tv/1234; `?mute` wycisza, `?k=` rodzinny klucz) */
  | {
      screen: 'party-tv'
      code: string | null
      mute: boolean
      accessKey: string | null
      /** #/pc: gra na samym komputerze — klawiatura i pady jako gracze */
      pc: boolean
    }
  /** tryb party: szybkie testy na PC — TV i pad obok siebie, pad z klawiatury (#/test) */
  | { screen: 'party-test' }
  | { screen: 'control-lab' }
  | { screen: 'control-lab-pad'; token: string }
  /** tryb developera: gra + panel statystyk, sztuczek i podglądu animacji (#/dev) */
  | { screen: 'party-dev' }
  /** tryb party: telefon jako pad (#/pad/1234?k=…) */
  /** `?gracz=1` — zawsze ten gracz (przejmuje go od innego telefonu); używa tego #/test */
  | { screen: 'party-pad'; code: string | null; accessKey: string | null; player: number | null }

/** 地址栏里可能出现 "%" 这样的非法编码；解不开就原样返回，交给后面的无效路由回退 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const queryIndex = raw.indexOf('?')
  const path = queryIndex === -1 ? raw : raw.slice(0, queryIndex)
  const multi = queryIndex !== -1 && raw.slice(queryIndex) === MULTI_PLAYERS_SEARCH
  const [head = '', a, b] = path
    .split('/')
    .filter((s) => s !== '')
    .map(decodeSegment)

  switch (head) {
    case 'choose':
      return { screen: 'choose', stageName: a ?? null, multi }
    case 'stage':
      return { screen: 'battle', stageName: a ?? null, multi }
    case 'gameover':
      return { screen: 'gameover', multi }
    case 'list': {
      const tab = a === 'default' || a === 'custom' ? a : null
      const page = Number(b)
      return { screen: 'stage-list', tab, page: Number.isInteger(page) && page > 0 ? page : null }
    }
    case 'editor':
      return { screen: 'editor', view: a === 'config' || a === 'map' ? a : null }
    case 'gallery':
      return {
        screen: 'gallery',
        tab: GALLERY_TABS.find((tab) => tab === a) ?? null,
      }
    case 'options':
      return { screen: 'options' }
    case 'lobby':
      return { screen: 'lobby', view: a === 'create' || a === 'room' ? a : 'list' }
    case 'tv':
    case 'pc': {
      const params = new URLSearchParams(queryIndex === -1 ? '' : raw.slice(queryIndex + 1))
      return {
        screen: 'party-tv',
        code: isRoomCode(a) ? a : null,
        mute: params.has('mute'),
        accessKey: params.get('k'),
        pc: head === 'pc',
      }
    }
    case 'test':
      return { screen: 'party-test' }
    case 'poligon':
    case 'sterowanie': // stara nazwa — stare zakładki dalej działają
      return { screen: 'control-lab' }
    case 'poligon-pad':
    case 'sterowanie-pad':
      return { screen: 'control-lab-pad', token: a ?? '' }
    case 'dev':
      return { screen: 'party-dev' }
    case 'pad': {
      const params = new URLSearchParams(queryIndex === -1 ? '' : raw.slice(queryIndex + 1))
      const player = Number(params.get('gracz'))
      return {
        screen: 'party-pad',
        code: isRoomCode(a) ? a : null,
        accessKey: params.get('k'),
        player: player === 1 || player === 2 ? player - 1 : null,
      }
    }
    default:
      // 原版未匹配的路径一律渲染标题页
      return { screen: 'title' }
  }
}

export function playersSearch(multi: boolean): string {
  return multi ? MULTI_PLAYERS_SEARCH : ''
}

export function stagePath(kind: 'choose' | 'stage', stageName: string, multi: boolean): string {
  return `/${kind}/${encodeURIComponent(stageName)}${playersSearch(multi)}`
}

export function push(path: string): void {
  location.hash = path
}

export function replace(path: string): void {
  const url = new URL(location.href)
  url.hash = path
  history.replaceState(history.state, '', url)
  // replaceState 不触发 hashchange，手动通知订阅方
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function goBack(): void {
  history.back()
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

let cachedHash: string | null = null
let cachedRoute: Route = { screen: 'title' }

/** 当前路由；同一 hash 返回同一对象，保证 useSyncExternalStore 快照稳定 */
export function currentRoute(): Route {
  const hash = location.hash
  if (hash !== cachedHash) {
    cachedHash = hash
    cachedRoute = parseHash(hash)
  }
  return cachedRoute
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute)
}
