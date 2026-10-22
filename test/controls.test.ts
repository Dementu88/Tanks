import { describe, expect, it, vi } from 'vitest'
import { readGamepad, watchGamepads } from '../src/party/controls'

function pad(pressed: number[] = [], axes: [number, number] = [0, 0]): Gamepad {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: pressed.includes(i),
      touched: false,
      value: pressed.includes(i) ? 1 : 0,
    })),
  } as unknown as Gamepad
}

describe('pad PlayStation / Xbox', () => {
  it('cztery pady jednego TV zachowują osobne wejścia, komendy i rozłączenia', () => {
    let tick: FrameRequestCallback = () => {}
    let pads: (Gamepad | null)[] = [12, 13, 14, 15].map(
      (button, index) =>
        ({ ...pad([button]), index, id: `pad-${index}`, connected: true }) as Gamepad,
    )
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      tick = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('navigator', { getGamepads: () => pads })
    const onConnect = vi.fn(),
      onInput = vi.fn(),
      onCommand = vi.fn(),
      onDisconnect = vi.fn()
    try {
      const stop = watchGamepads({ onConnect, onInput, onCommand, onDisconnect })
      tick(0)
      expect(onConnect.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3])
      expect(onInput.mock.calls.map((c) => [c[0], c[1].direction])).toEqual([
        [0, 'up'],
        [1, 'down'],
        [2, 'left'],
        [3, 'right'],
      ])
      onInput.mockClear()
      pads[2] = { ...pads[2]!, buttons: pad([0, 9]).buttons, axes: [0, 0] }
      tick(16)
      expect(onInput.mock.calls).toHaveLength(1)
      expect(onInput).toHaveBeenCalledWith(2, { direction: null, turnOnly: false, fire: true })
      expect(onCommand).toHaveBeenCalledWith(2, 'start')
      pads[1] = null
      tick(32)
      expect(onDisconnect).toHaveBeenCalledWith(1)
      expect(onCommand).toHaveBeenCalledTimes(1)
      stop()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('krzyżak to jazda, ✕ to ogień', () => {
    expect(readGamepad(pad([12, 0]))).toEqual({ direction: 'up', turnOnly: false, fire: true })
    expect(readGamepad(pad([15]))).toEqual({ direction: 'right', turnOnly: false, fire: false })
  })

  it('gałka: martwa strefa, małe wychylenie obrót, duże jazda', () => {
    expect(readGamepad(pad([], [0.1, 0.1])).direction).toBeNull()
    expect(readGamepad(pad([], [-0.4, 0]))).toEqual({
      direction: 'left',
      turnOnly: true,
      fire: false,
    })
    expect(readGamepad(pad([], [0, 0.9]))).toEqual({
      direction: 'down',
      turnOnly: false,
      fire: false,
    })
  })

  it('R2 i □ też strzelają', () => {
    expect(readGamepad(pad([7])).fire).toBe(true)
    expect(readGamepad(pad([2])).fire).toBe(true)
  })
})
