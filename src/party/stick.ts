import type { Direction } from '../engine/types'

export interface StickState {
  direction: Direction | null
  turnOnly: boolean
}

export interface StickSettings {
  deadZone: number
  turnZone: number
  directionMargin: number
  modeMargin: number
  sensitivity: number
  floating: boolean
  vibration: number
}

export const IDLE_STICK: StickState = { direction: null, turnOnly: false }
export const ORIGINAL_STICK: StickSettings = {
  deadZone: 0.12,
  turnZone: 0.42,
  directionMargin: 0,
  modeMargin: 0,
  sensitivity: 1,
  floating: false,
  vibration: 8,
}
export const STABLE_STICK: StickSettings = {
  deadZone: 0.1,
  turnZone: 0.3,
  directionMargin: 0.18,
  modeMargin: 0.04,
  sensitivity: 1.2,
  floating: false,
  vibration: 8,
}

export function readStick(
  x: number,
  y: number,
  previous: StickState,
  settings: StickSettings,
): StickState {
  const dx = x * settings.sensitivity
  const dy = y * settings.sensitivity
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  const distance = Math.max(ax, ay)
  if (distance < settings.deadZone) return IDLE_STICK
  let direction: Direction = ax > ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
  // Margines dotyczy zmiany osi; odwrócenie kierunku musi działać od razu.
  const old = previous.direction
  if (settings.directionMargin > 0 && ((old === 'left' && dx < 0) || (old === 'right' && dx > 0))) {
    if (ay <= ax * (1 + settings.directionMargin)) direction = old
  } else if (
    settings.directionMargin > 0 &&
    ((old === 'up' && dy < 0) || (old === 'down' && dy > 0))
  ) {
    if (ax <= ay * (1 + settings.directionMargin)) direction = old
  }
  const driving = old != null && !previous.turnOnly
  const threshold = driving
    ? Math.max(settings.deadZone, settings.turnZone - settings.modeMargin)
    : settings.turnZone
  return { direction, turnOnly: distance < threshold }
}
