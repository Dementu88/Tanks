import type { Direction } from '../engine/types'
import { encodeInput } from '../lan/input'
import { INPUT_TURN_ONLY } from './protocol'

/**
 * Fizyczne sterowanie (klawiatura, pad PlayStation/Xbox przez Gamepad API) — wspólne dla
 * pada na telefonie, strony testowej i graczy podpiętych bezpośrednio do TV / PC.
 */

export interface PadInput {
  direction: Direction | null
  /** małe wychylenie: czołg tylko się obraca */
  turnOnly: boolean
  fire: boolean
}

/** start: w lobby START, w grze pauza / wznowienie */
export type PadCommand =
  | 'start'
  | 'pause'
  | 'stage-prev'
  | 'stage-next'
  | 'difficulty-down'
  | 'difficulty-up'

export const IDLE_INPUT: PadInput = { direction: null, turnOnly: false, fire: false }

export function sameInput(a: PadInput, b: PadInput): boolean {
  return a.direction === b.direction && a.turnOnly === b.turnOnly && a.fire === b.fire
}

/** bity wiadomości 'in' (jak lan/input encodeInput + INPUT_TURN_ONLY) */
export function encodePadInput(input: PadInput): number {
  return (
    encodeInput({ direction: input.direction, fireHeld: input.fire, firePressed: false }) |
    (input.turnOnly ? INPUT_TURN_ONLY : 0)
  )
}

// ---------- klawiatura ----------

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
}
const FIRE_KEYS = new Set(['Space', 'KeyJ', 'KeyK'])
const KEY_COMMANDS: Record<string, PadCommand> = {
  Enter: 'start',
  // Enter z klawiatury numerycznej to dla przeglądarki osobny klawisz
  NumpadEnter: 'start',
  KeyP: 'pause',
  Escape: 'pause',
  KeyQ: 'stage-prev',
  KeyE: 'stage-next',
  KeyZ: 'difficulty-down',
  KeyX: 'difficulty-up',
}

/**
 * Strzałki / WASD jazda (z Shift tylko obrót), spacja / J ogień, Enter start, P / Esc pauza,
 * Q / E plansza, Z / X poziom trudności. Zwraca funkcję odpinającą.
 */
export function attachKeyboard(
  target: Window,
  onInput: (input: PadInput) => void,
  onCommand: (command: PadCommand) => void,
): () => void {
  /** wciśnięte kierunki w kolejności — działa ostatni, jak w oryginale */
  let order: Direction[] = []
  let shift = false
  const fireKeys = new Set<string>()
  const publish = () => {
    const direction = order[order.length - 1] ?? null
    onInput({ direction, turnOnly: direction != null && shift, fire: fireKeys.size > 0 })
  }
  const onDown = (e: KeyboardEvent) => {
    shift = e.shiftKey
    const dir = KEY_DIRECTIONS[e.code]
    const command = KEY_COMMANDS[e.code]
    if (dir != null) {
      if (!order.includes(dir)) order = [...order, dir]
    } else if (FIRE_KEYS.has(e.code)) {
      fireKeys.add(e.code)
    } else if (command != null) {
      if (!e.repeat) onCommand(command)
    } else if (!e.code.startsWith('Shift')) {
      return
    }
    e.preventDefault()
    publish()
  }
  const onUp = (e: KeyboardEvent) => {
    shift = e.shiftKey
    const dir = KEY_DIRECTIONS[e.code]
    if (dir != null) order = order.filter((d) => d !== dir)
    fireKeys.delete(e.code)
    publish()
  }
  const onBlur = () => {
    order = []
    fireKeys.clear()
    publish()
  }
  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)
  return () => {
    target.removeEventListener('keydown', onDown)
    target.removeEventListener('keyup', onUp)
    target.removeEventListener('blur', onBlur)
  }
}

// ---------- pad (Gamepad API, układ „standard”: PlayStation / Xbox) ----------

/** gałka: do 0.25 nic, do 0.6 tylko obrót, dalej jazda */
const STICK_DEAD = 0.25
const STICK_TURN = 0.6

const enum Btn {
  Cross = 0,
  Circle = 1,
  Square = 2,
  Triangle = 3,
  L1 = 4,
  R1 = 5,
  L2 = 6,
  R2 = 7,
  Share = 8,
  Options = 9,
  Up = 12,
  Down = 13,
  Left = 14,
  Right = 15,
}

const pressed = (gp: Gamepad, b: number) => gp.buttons[b]?.pressed === true

/** stan jednego pada: krzyżak = jazda, lewa gałka = obrót/jazda, ✕ / □ / R1 / R2 = ogień */
export function readGamepad(gp: Gamepad): PadInput {
  const fire = [Btn.Cross, Btn.Square, Btn.R1, Btn.R2].some((b) => pressed(gp, b))
  let direction: Direction | null = null
  let turnOnly = false
  if (pressed(gp, Btn.Up)) direction = 'up'
  else if (pressed(gp, Btn.Down)) direction = 'down'
  else if (pressed(gp, Btn.Left)) direction = 'left'
  else if (pressed(gp, Btn.Right)) direction = 'right'
  else {
    const x = gp.axes[0] ?? 0
    const y = gp.axes[1] ?? 0
    const dist = Math.hypot(x, y)
    if (dist >= STICK_DEAD) {
      direction = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up'
      turnOnly = dist < STICK_TURN
    }
  }
  return { direction, turnOnly, fire }
}

/** przyciski poleceń: Options = start / pauza, L1 / △ plansza, L2 / Share trudność */
const COMMAND_BUTTONS: [number, PadCommand][] = [
  [Btn.Options, 'start'],
  [Btn.L1, 'stage-prev'],
  [Btn.Triangle, 'stage-next'],
  [Btn.L2, 'difficulty-down'],
  [Btn.Share, 'difficulty-up'],
]

export interface GamepadHandlers {
  /** pad pierwszy raz wcisnął przycisk (przeglądarki ujawniają pada dopiero po naciśnięciu) */
  onConnect?: (index: number, name: string) => void
  onDisconnect?: (index: number) => void
  onInput: (index: number, input: PadInput) => void
  onCommand: (index: number, command: PadCommand) => void
}

/** czyta pady co klatkę (Gamepad API nie ma zdarzeń dla przycisków) */
export function watchGamepads(handlers: GamepadHandlers): () => void {
  if (typeof navigator.getGamepads !== 'function') return () => {}
  const last = new Map<number, { input: PadInput; buttons: boolean[] }>()
  let raf = 0
  const tick = () => {
    const pads = navigator.getGamepads()
    const seen = new Set<number>()
    for (const gp of pads) {
      if (gp == null || !gp.connected) continue
      seen.add(gp.index)
      const input = readGamepad(gp)
      const buttons = gp.buttons.map((b) => b.pressed)
      const prev = last.get(gp.index)
      if (prev == null) {
        handlers.onConnect?.(gp.index, gp.id)
      }
      if (prev == null || !sameInput(prev.input, input)) handlers.onInput(gp.index, input)
      for (const [b, command] of COMMAND_BUTTONS) {
        if (buttons[b] && !(prev?.buttons[b] ?? false)) handlers.onCommand(gp.index, command)
      }
      last.set(gp.index, { input, buttons })
    }
    for (const index of [...last.keys()]) {
      if (!seen.has(index)) {
        last.delete(index)
        handlers.onDisconnect?.(index)
      }
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
