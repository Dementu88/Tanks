import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import PadScreen from '../src/party/PadScreen'
import { encodePadInput } from '../src/party/controls'

const { sendParty } = vi.hoisted(() => ({ sendParty: vi.fn() }))
vi.mock('../src/party/client', () => ({
  sendParty,
  connectParty: vi.fn(),
  disconnectParty: vi.fn(),
  rememberPartyKey: vi.fn(),
  setBuzzHandler: vi.fn(),
  usePartyStore: (select: (state: unknown) => unknown) =>
    select({
      room: {
        playing: false,
        paused: false,
        difficultyChooser: 0,
        stageIndex: 0,
        stageCount: 35,
        difficulty: 0,
        difficultyNames: ['Normalny'],
        playerOfSlot: [0],
      },
      slot: 0,
      connected: true,
      full: false,
      replaced: false,
      error: null,
    }),
}))

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('pad gry używa profilu stable mimo starego zapisu, stabilizuje skręt i wysyła STOP', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('innerWidth', 844)
  vi.stubGlobal('innerHeight', 390)
  localStorage.setItem('party-turn-zone', '0.7')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    act(() => root.render(createElement(PadScreen, { code: '1234', accessKey: null })))
    expect(host.querySelector('input')?.value).toBe('0.3')
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Czułość — siatka skrętu"]')?.value,
    ).toBe('8')
    expect(sendParty).toHaveBeenCalledWith({ t: 'sensitivity', turnSnap: 8 })
    expect((host.querySelector('.pad') as HTMLElement).style.getPropertyValue('--pad-fire')).toBe(
      '246px',
    )
    const key = new KeyboardEvent('keydown', {
      code: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    })
    sendParty.mockClear()
    act(() => host.querySelector('[aria-label="Czułość — siatka skrętu"]')!.dispatchEvent(key))
    expect(key.defaultPrevented).toBe(false)
    expect(sendParty).not.toHaveBeenCalled()
    const stick = host.querySelector('.pad-stick')!
    const captured = new Set<number>()
    stick.setPointerCapture = (id) => {
      captured.add(id)
    }
    stick.hasPointerCapture = (id) => captured.has(id)
    stick.releasePointerCapture = (id) => {
      captured.delete(id)
    }
    vi.spyOn(stick, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      toJSON: () => ({}),
    })
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true })
      Object.assign(event, { pointerId: 1, clientX: x, clientY: y, button: 0 })
      act(() => stick.dispatchEvent(event))
    }
    const right = encodePadInput({ direction: 'right', turnOnly: false, fire: false })
    pointer('pointerdown', 126, 100)
    expect(sendParty).toHaveBeenLastCalledWith({ t: 'in', b: right })
    pointer('pointermove', 150, 49)
    expect(sendParty).toHaveBeenLastCalledWith({ t: 'in', b: right })
    pointer('pointermove', 150, 30)
    expect(sendParty).toHaveBeenLastCalledWith({
      t: 'in',
      b: encodePadInput({
        direction: 'up',
        turnOnly: false,
        fire: false,
      }),
    })
    act(() => window.dispatchEvent(new Event('blur')))
    expect(sendParty).toHaveBeenLastCalledWith({ t: 'in', b: 0 })
    expect(localStorage.getItem('party-turn-zone')).toBe('0.7')
    expect(localStorage.getItem('party-turn-zone-stable')).toBe('0.3')
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('czułość odczytuje zapis telefonu i przekazuje go serwerowi', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.setItem('party-turn-snap-stable', '16')
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    act(() => root.render(createElement(PadScreen, { code: '1234', accessKey: null })))
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Czułość — siatka skrętu"]')?.value,
    ).toBe('16')
    expect(sendParty).toHaveBeenCalledWith({ t: 'sensitivity', turnSnap: 16 })
  } finally {
    act(() => root.unmount())
  }
})
