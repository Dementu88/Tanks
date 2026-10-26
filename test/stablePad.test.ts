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

it('pad gry: strzałki zamiast joysticka, czułość z profilu stable, STOP po utracie fokusu', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('innerWidth', 844)
  vi.stubGlobal('innerHeight', 390)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    act(() => root.render(createElement(PadScreen, { code: '1234', accessKey: null })))
    expect(host.querySelector('.pad-stick')).toBeNull()
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
    const pad = host.querySelector('.pad-arrows')!
    pad.setPointerCapture = () => {}
    pad.hasPointerCapture = () => false
    pad.releasePointerCapture = () => {}
    let under = host.querySelector('[data-dir="right"]')
    document.elementFromPoint = () => under
    const pointer = (type: string) => {
      const event = new Event(type, { bubbles: true })
      Object.assign(event, { pointerId: 1, clientX: 0, clientY: 0, button: 0 })
      act(() => pad.dispatchEvent(event))
    }
    pointer('pointerdown')
    expect(sendParty).toHaveBeenLastCalledWith({
      t: 'in',
      b: encodePadInput({ direction: 'right', turnOnly: false, fire: false }),
    })
    under = host.querySelector('[data-dir="up"]')
    pointer('pointermove')
    expect(sendParty).toHaveBeenLastCalledWith({
      t: 'in',
      b: encodePadInput({ direction: 'up', turnOnly: false, fire: false }),
    })
    act(() => window.dispatchEvent(new Event('blur')))
    expect(sendParty).toHaveBeenLastCalledWith({ t: 'in', b: 0 })
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
