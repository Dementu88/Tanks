import { describe, expect, it } from 'vitest'
import { IDLE_STICK, ORIGINAL_STICK, STABLE_STICK, readStick } from '../src/party/stick'

describe('joystick telefonu', () => {
  it('zachowuje dotychczasowe progi i podział kierunków w profilu obecnego pada', () => {
    expect(readStick(0.1, 0.1, IDLE_STICK, ORIGINAL_STICK)).toEqual(IDLE_STICK)
    expect(readStick(0.3, 0, IDLE_STICK, ORIGINAL_STICK)).toEqual({
      direction: 'right',
      turnOnly: true,
    })
    expect(readStick(0, -0.5, IDLE_STICK, ORIGINAL_STICK)).toEqual({
      direction: 'up',
      turnOnly: false,
    })
    expect(
      readStick(0.5, 0.5, { direction: 'right', turnOnly: false }, ORIGINAL_STICK).direction,
    ).toBe('down')
  })
  it('stabilizuje przekątną, ale pozwala na zdecydowany skręt i natychmiastowy zwrot', () => {
    const right = { direction: 'right', turnOnly: false } as const
    expect(readStick(0.5, -0.51, right, STABLE_STICK).direction).toBe('right')
    expect(readStick(0.5, -0.7, right, STABLE_STICK).direction).toBe('up')
    expect(readStick(-0.5, 0, right, STABLE_STICK).direction).toBe('left')
  })
  it('nie szarpie jazdą na granicy stref i zatrzymuje się w środku', () => {
    const config = { ...STABLE_STICK, sensitivity: 1 }
    const moving = readStick(0.31, 0, IDLE_STICK, config)
    expect(moving.turnOnly).toBe(false)
    expect(readStick(0.29, 0, moving, config).turnOnly).toBe(false)
    expect(readStick(0.25, 0, moving, config).turnOnly).toBe(true)
    expect(readStick(0, 0, moving, config)).toEqual(IDLE_STICK)
    expect(readStick(0.29, 0, IDLE_STICK, config).turnOnly).toBe(true)
  })
  it('czułość skraca potrzebne przesunięcie palca', () => {
    expect(readStick(0.22, 0, IDLE_STICK, ORIGINAL_STICK).turnOnly).toBe(true)
    expect(readStick(0.22, 0, IDLE_STICK, { ...ORIGINAL_STICK, sensitivity: 2 }).turnOnly).toBe(
      false,
    )
  })
})
