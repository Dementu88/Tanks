import { create } from 'zustand'
import { setPlayerStatsTable } from '../engine/tankStats'
import { FrameMirror } from '../lan/frame'
import {
  CLOSE_BAD_KEY,
  CLOSE_REPLACED,
  PARTY_PATH,
  type PartyClientMessage,
  type PartyRole,
  type PartyRoomState,
  type PartyServerMessage,
} from './protocol'

export interface PartyState {
  connected: boolean
  room: PartyRoomState | null
  code: string | null
  slot: number | null
  error: string | null
  /** numer lustra gry; TV przebudowuje ekran, gdy dostanie nowe (nowa gra albo reconnect) */
  game: number
  /** serwer odrzucił klucz */
  denied: boolean
  /** pad: oba sloty zajęte — można przejąć jeden z nich */
  full: boolean
  /** pad: ten slot przejął inny telefon */
  replaced: boolean
  /** ostatni awans gracza (powiadomienie na kilka sekund) */
  promotion: { name: string; logo: string; rank: number; key: number } | null
}

const INITIAL: PartyState = {
  connected: false,
  room: null,
  code: null,
  slot: null,
  error: null,
  game: 0,
  denied: false,
  full: false,
  replaced: false,
  promotion: null,
}

export const usePartyStore = create<PartyState>(() => INITIAL)

let socket: WebSocket | null = null
/** wiadomość dołączenia: wysyłana po każdym (ponownym) połączeniu */
let joinMessage: PartyClientMessage | null = null
let retryTimer = 0
let mirror: FrameMirror | null = null
let onBuzz: ((ms: number) => void) | null = null

/** względem katalogu strony: gra może stać za nginxem pod np. /bc/ */
export function socketUrl(): string {
  const dir = location.pathname.replace(/[^/]*$/, '')
  const key = partyKey()
  const query = key == null ? '' : `?k=${encodeURIComponent(key)}`
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${dir}${PARTY_PATH.slice(1)}${query}`
}

const KEY_STORAGE = 'party-key'
/** zapas, gdy localStorage nie działa (prywatne okno) */
let memoryKey: string | null = null

/** rodzinny klucz: z adresu (?k=…) zapamiętujemy, żeby zakładka na TV działała bez niego */
export function partyKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? memoryKey
  } catch {
    return memoryKey
  }
}

export function rememberPartyKey(key: string | null): void {
  if (key == null || key === '') return
  memoryKey = key
  try {
    localStorage.setItem(KEY_STORAGE, key)
  } catch {
    // prywatne okno — klucz zostaje w pamięci strony
  }
}

function forgetPartyKey(): void {
  memoryKey = null
  try {
    localStorage.removeItem(KEY_STORAGE)
  } catch {
    // jw.
  }
}

const DEVICE_STORAGE = 'party-device'
let memoryDevice: string | null = null

/**
 * Stały identyfikator telefonu. Ten sam telefon (druga karta, podgląd QR z aparatu, zerwane
 * połączenie) zastępuje swoje stare połączenie zamiast blokować slot.
 */
export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_STORAGE)
    if (saved != null) return saved
  } catch {
    // prywatne okno
  }
  memoryDevice ??= Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join('')
  try {
    localStorage.setItem(DEVICE_STORAGE, memoryDevice)
  } catch {
    // jw.
  }
  return memoryDevice
}

function open(): void {
  const ws = new WebSocket(socketUrl())
  socket = ws
  ws.onopen = () => {
    usePartyStore.setState({ connected: true })
    if (joinMessage != null) ws.send(JSON.stringify(joinMessage))
  }
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') handle(JSON.parse(e.data) as PartyServerMessage)
  }
  ws.onclose = (e) => {
    if (socket !== ws) return
    socket = null
    usePartyStore.setState({ connected: false })
    if (e.code === CLOSE_BAD_KEY) {
      // zły albo stary klucz: ponawianie nic nie da, potrzebny nowy link
      forgetPartyKey()
      joinMessage = null
      usePartyStore.setState({
        error: 'Brak dostępu: otwórz link z rodzinnym kluczem',
        denied: true,
      })
      return
    }
    if (e.code === CLOSE_REPLACED) {
      // ktoś świadomie przejął ten pad; samo ponawianie odebrałoby mu go z powrotem
      joinMessage = null
      usePartyStore.setState({
        slot: null,
        replaced: true,
        error: 'Ten pad przejął inny telefon',
      })
      return
    }
    // telefon po wygaszeniu ekranu, Wi-Fi, restart serwera — łączymy się dalej sami
    retryTimer = window.setTimeout(open, 1000)
  }
}

function handle(msg: PartyServerMessage): void {
  switch (msg.t) {
    case 'joined':
      usePartyStore.setState({
        code: msg.code,
        slot: msg.slot,
        error: null,
        full: false,
        replaced: false,
      })
      // po reconnecie wracamy na ten sam slot i do tego samego pokoju
      if (msg.role === 'tv') joinMessage = { t: 'tv', code: msg.code }
      else
        joinMessage = {
          t: 'pad',
          code: msg.code,
          slot: msg.slot ?? undefined,
          device: deviceId(),
        }
      return
    case 'room':
      if (!msg.room.playing) mirror = null
      usePartyStore.setState({ room: msg.room })
      return
    case 'error':
      usePartyStore.setState(
        msg.code === 'full'
          ? { error: msg.message, full: true, slot: null }
          : { error: msg.message },
      )
      return
    case 'start':
      mirror = new FrameMirror()
      usePartyStore.setState((s) => ({ game: s.game + 1 }))
      return
    case 'f':
      mirror?.apply(msg)
      return
    case 'buzz':
      onBuzz?.(msg.ms)
      return
    case 'tank-config':
      setPlayerStatsTable(msg.stats)
      return
    case 'promotion':
      usePartyStore.setState({
        promotion: { name: msg.name, logo: msg.logo, rank: msg.rank, key: Date.now() },
      })
      return
  }
}

/** takeover: przejmij wskazany slot, nawet jeśli trzyma go inny telefon */
export function connectParty(
  role: PartyRole,
  code: string | null,
  slot?: number,
  takeover = false,
): void {
  joinMessage =
    role === 'tv'
      ? { t: 'tv', code: code ?? undefined }
      : { t: 'pad', code: code ?? '', slot, device: deviceId(), takeover }
  usePartyStore.setState({ full: false, replaced: false })
  if (socket == null) open()
  else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(joinMessage))
}

export function disconnectParty(): void {
  window.clearTimeout(retryTimer)
  const ws = socket
  socket = null
  joinMessage = null
  mirror = null
  ws?.close()
  usePartyStore.setState(INITIAL)
}

export function sendParty(msg: PartyClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

/** lustro bieżącej gry na TV; null poza grą */
export function partyMirror(): FrameMirror | null {
  return mirror
}

export function setBuzzHandler(fn: ((ms: number) => void) | null): void {
  onBuzz = fn
}
