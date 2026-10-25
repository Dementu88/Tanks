import { encodePadInput, IDLE_INPUT, type PadCommand, type PadInput } from './controls'
import type { PartyClientMessage, PartyRoomState, PartyServerMessage } from './protocol'
import { socketUrl } from './client'
import { canTakeProfile, nextProfileId, rememberProfile, savedProfile } from './profilePick'

export interface LocalPadState {
  slot: number | null
  /** np. „Oba pady są już zajęte” */
  error: string | null
}

/**
 * Pad bez telefonu: klawiatura albo pad PS podpięty do urządzenia, które wyświetla grę (TV / PC).
 * Dla serwera to zwykły pad — osobne połączenie WebSocket ze stałym identyfikatorem urządzenia.
 */
export class LocalPad {
  private ws: WebSocket | null = null
  private closed = false
  private retry = 0
  private bits = encodePadInput(IDLE_INPUT)
  private room: PartyRoomState | null = null
  private slot: number | null = null
  private direction: PadInput['direction'] = null
  /** zapamiętany profil wysłany po dołączeniu (raz na połączenie) */
  private restored = false

  constructor(
    /** stały identyfikator (np. `<urządzenie>-pad0`) — ten sam pad wraca do swojego gracza */
    private readonly device: string,
    private readonly code: string,
    private readonly onState: (state: LocalPadState) => void,
  ) {
    this.open()
  }

  private open(): void {
    const ws = new WebSocket(socketUrl())
    this.ws = ws
    ws.onopen = () => {
      this.send({ t: 'pad', code: this.code, device: this.device, slot: this.slot ?? undefined })
    }
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      const msg = JSON.parse(e.data) as PartyServerMessage
      if (msg.t === 'joined') {
        this.slot = msg.slot
        this.restored = false
        this.onState({ slot: msg.slot, error: null })
        this.send({ t: 'in', b: this.bits })
      } else if (msg.t === 'room') {
        this.room = msg.room
        this.restoreProfile()
      } else if (msg.t === 'error') {
        this.onState({ slot: null, error: msg.message })
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return
      this.ws = null
      this.retry = window.setTimeout(() => this.open(), 1000)
    }
  }

  private send(msg: PartyClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  /** klucz zapamiętanego profilu tego pada / klawiatury w przeglądarce */
  private get profileKey(): string {
    return 'party-player-' + this.device
  }

  /** po dołączeniu: zapamiętany profil, jeśli jest wolny */
  private restoreProfile(): void {
    const { room, slot } = this
    if (this.restored || room == null || slot == null || room.playing) return
    this.restored = true
    const wanted = savedProfile(this.profileKey)
    if (room.padPlayers?.[slot] != null || wanted == null) return
    if (canTakeProfile(room, slot, wanted)) this.send({ t: 'player', id: wanted })
  }

  /** lobby: następny / poprzedni profil gracza (strzałki lewo-prawo albo ‹ › na ekranie) */
  stepProfile(delta: number): void {
    const { room, slot } = this
    if (room == null || slot == null || room.playing || (room.players?.length ?? 0) === 0) return
    const next = nextProfileId(room, slot, delta)
    rememberProfile(this.profileKey, next)
    this.send({ t: 'player', id: next })
  }

  /** lobby: kolor czołgu (strzałki góra-dół albo ▲ ▼ na ekranie) */
  stepColor(delta: number): void {
    const { room, slot } = this
    if (room == null || slot == null || room.playing) return
    this.send({ t: 'color', delta })
  }

  setInput(input: PadInput): void {
    // w lobby lewo / prawo zmienia profil, góra / dół kolor (tylko przy wciśnięciu, nie przy trzymaniu)
    if (input.direction !== this.direction) {
      this.direction = input.direction
      if (input.direction === 'left') this.stepProfile(-1)
      else if (input.direction === 'right') this.stepProfile(1)
      else if (input.direction === 'up') this.stepColor(-1)
      else if (input.direction === 'down') this.stepColor(1)
    }
    const bits = encodePadInput(input)
    if (bits === this.bits) return
    this.bits = bits
    this.send({ t: 'in', b: bits })
  }

  command(command: PadCommand): void {
    const playing = this.room?.playing === true
    // pauza: Q / L1 kończy grę i wraca do lobby
    if (playing && this.room?.paused === true && command === 'stage-prev') {
      this.send({ t: 'quit' })
      return
    }
    if (command === 'start') this.send(playing ? { t: 'pause' } : { t: 'start' })
    else if (command === 'pause' && playing) this.send({ t: 'pause' })
    else if (command === 'stage-prev') this.send({ t: 'stage', delta: -1 })
    else if (command === 'stage-next') this.send({ t: 'stage', delta: 1 })
    else if (command === 'difficulty-down') this.send({ t: 'difficulty', delta: -1 })
    else if (command === 'difficulty-up') this.send({ t: 'difficulty', delta: 1 })
  }

  close(): void {
    this.closed = true
    window.clearTimeout(this.retry)
    this.ws?.close()
    this.ws = null
  }
}
