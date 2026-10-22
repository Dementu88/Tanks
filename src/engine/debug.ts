import type { Direction } from './types'

/**
 * Podgląd „myślenia” czołgów w trybie developera: dokąd jedzie AI i po co.
 * Tylko do rysowania — silnik niczego z tego nie czyta.
 */
export interface DebugTankInfo {
  tankId: number
  side: 'bot' | 'player'
  /** środek czołgu (jednostki gry) */
  x: number
  y: number
  /** stan AI: planning / following / attackTurning / attackFiring / waiting / autopilot … */
  mode: string
  /** po co jedzie: eagle = atak na orła, wander = wędrówka, guard = osłona (autopilot) */
  goal: 'eagle' | 'wander' | 'guard' | null
  /** pozostałe punkty trasy — środki kratek (jednostki gry) */
  path: [number, number][]
  /** trasa przez cegły (będzie je rozstrzeliwać) */
  dig: boolean
  /** kierunek, w który właśnie celuje (obrót do strzału z boku) */
  aim: Direction | null
}
