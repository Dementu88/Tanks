import type Tank from '../entities/Tank'
import type { Direction } from '../types'
import { canTankMove, type CollisionWorld } from './collision'
import { getDirectionInfo } from './geometry'

export const validTurnSnap = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 32 &&
  value % 4 === 0

/** najbliższa linia siatki `grid`, do której da się dojechać bez przenikania przez ściany */
function alignedCoord(world: CollisionWorld, tank: Tank, grid: number): number {
  const { axis } = getDirectionInfo(tank.direction)
  const original = tank[axis]
  if (grid <= 0) return original
  const lower = Math.floor(original / grid) * grid
  const upper = Math.ceil(original / grid) * grid
  const candidates = [lower, upper].sort(
    (a, b) => Math.abs(a - original) - Math.abs(b - original) || b - a,
  )
  for (const target of candidates) {
    const steps = Math.max(1, Math.ceil(Math.abs(target - original)))
    let clear = true
    // Cała droga musi być wolna, żeby duża siatka nie przenosiła czołgu przez ściany.
    for (let step = 1; step <= steps; step++) {
      tank[axis] = original + ((target - original) * step) / steps
      if (!canTankMove(world, tank)) {
        clear = false
        break
      }
    }
    tank[axis] = original
    if (clear) return target
  }
  return original
}

function reserve(tank: Tank, aligned: number): void {
  const { axis } = getDirectionInfo(tank.direction)
  tank.rx = axis === 'x' ? aligned : tank.x
  tank.ry = axis === 'y' ? aligned : tank.y
}

/** czy czołg ustawiony na rx/ry ruszy w `direction` (stan czołgu wraca) */
function canGoAfterTurn(world: CollisionWorld, tank: Tank, direction: Direction): boolean {
  const { x, y, direction: before } = tank
  tank.x = tank.rx
  tank.y = tank.ry
  tank.direction = direction
  const { axis, delta } = getDirectionInfo(direction)
  tank[axis] += delta
  const ok = canTankMove(world, tank)
  tank.x = x
  tank.y = y
  tank.direction = before
  return ok
}

/**
 * Rezerwuje bezpieczną pozycję dla najbliższego skrętu o 90°.
 * `direction` — kierunek skrętu: gdy siatka z suwaka „Czułość” (np. WYŁ. albo 1×) zostawiłaby
 * czołg przy krawędzi przejścia, tak że po skręcie nie ruszy, bierzemy siatkę 8 px jak klawiatura
 * i oryginał — inaczej czołg z pada stawał przed dziurą w ścianie, jakby ściana dalej tam była.
 */
export function alignTurn(
  world: CollisionWorld,
  tank: Tank,
  grid: number,
  direction?: Direction,
): void {
  const chosen = alignedCoord(world, tank, grid)
  reserve(tank, chosen)
  if (direction == null || grid === 8 || canGoAfterTurn(world, tank, direction)) return
  for (const fallback of [8, 4]) {
    reserve(tank, alignedCoord(world, tank, fallback))
    if (canGoAfterTurn(world, tank, direction)) return
  }
  reserve(tank, chosen)
}
