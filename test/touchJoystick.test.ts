import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouchJoystick from '../src/party/TouchJoystick'
import { FireButton } from '../src/party/PadScreen'
import { IDLE_STICK, ORIGINAL_STICK } from '../src/party/stick'

let root: Root
let host: HTMLDivElement

function pointer(element: Element, type: string, id: number, x = 100, y = 100) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0 })
  act(() => {
    element.dispatchEvent(event)
  })
}

function geometry(element: Element) {
  const captured = new Set<number>()
  element.setPointerCapture = (id) => {
    captured.add(id)
  }
  element.hasPointerCapture = (id) => captured.has(id)
  element.releasePointerCapture = (id) => {
    captured.delete(id)
  }
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 200,
    height: 200,
    right: 200,
    bottom: 200,
    toJSON: () => ({}),
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('dotykowe sterowanie', () => {
  it('drugi palec nie przejmuje gałki, utrata przechwycenia zatrzymuje ruch', () => {
    const onChange = vi.fn()
    act(() => root.render(createElement(TouchJoystick, { stick: IDLE_STICK, onChange })))
    const element = host.querySelector('.pad-stick')!
    geometry(element)
    pointer(element, 'pointerdown', 1, 180, 100)
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'right', turnOnly: false })
    pointer(element, 'pointerdown', 2, 20, 100)
    pointer(element, 'pointerup', 2)
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'right', turnOnly: false })
    pointer(element, 'lostpointercapture', 1)
    expect(onChange).toHaveBeenLastCalledWith(IDLE_STICK)
    pointer(element, 'pointermove', 1, 180, 100)
    expect(onChange).toHaveBeenLastCalledWith(IDLE_STICK)
  })

  it('pływający środek zaczyna od STOP, utrata fokusu zwalnia gałkę', () => {
    const onChange = vi.fn()
    act(() =>
      root.render(
        createElement(TouchJoystick, {
          stick: IDLE_STICK,
          onChange,
          settings: { ...ORIGINAL_STICK, floating: true },
        }),
      ),
    )
    const element = host.querySelector('.pad-stick')!
    geometry(element)
    pointer(element, 'pointerdown', 1, 20, 40)
    expect(onChange).toHaveBeenLastCalledWith(IDLE_STICK)
    pointer(element, 'pointermove', 1, 100, 40)
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'right', turnOnly: false })
    act(() => window.dispatchEvent(new Event('blur')))
    expect(onChange).toHaveBeenLastCalledWith(IDLE_STICK)
  })

  it('przelicza osie w padzie obróconym o 90 stopni', () => {
    const onChange = vi.fn()
    act(() =>
      root.render(createElement(TouchJoystick, { stick: IDLE_STICK, onChange, rotated: true })),
    )
    const element = host.querySelector('.pad-stick')!
    geometry(element)
    pointer(element, 'pointerdown', 1, 100, 180)
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'right', turnOnly: false })
    pointer(element, 'pointercancel', 1)
    expect(onChange).toHaveBeenLastCalledWith(IDLE_STICK)
  })

  it('ognia nie przejmuje drugi palec i nie pozostaje wciśnięty po utracie fokusu', () => {
    const onChange = vi.fn()
    act(() => root.render(createElement(FireButton, { pressed: false, onChange, vibration: 0 })))
    const element = host.querySelector('.pad-fire')!
    geometry(element)
    pointer(element, 'pointerdown', 1)
    pointer(element, 'pointerdown', 2)
    pointer(element, 'pointerup', 2)
    expect(onChange).toHaveBeenLastCalledWith(true)
    act(() => window.dispatchEvent(new Event('blur')))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('zmiana rozmiaru okna (pasek adresu telefonu) nie zatrzymuje jazdy ani ognia', () => {
    const onStick = vi.fn()
    const onFire = vi.fn()
    act(() =>
      root.render(
        createElement('div', null, [
          createElement(TouchJoystick, { key: 's', stick: IDLE_STICK, onChange: onStick }),
          createElement(FireButton, { key: 'f', pressed: false, onChange: onFire, vibration: 0 }),
        ]),
      ),
    )
    const stick = host.querySelector('.pad-stick')!
    const fire = host.querySelector('.pad-fire')!
    geometry(stick)
    geometry(fire)
    pointer(stick, 'pointerdown', 1, 180, 100)
    pointer(fire, 'pointerdown', 2)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(onStick).toHaveBeenLastCalledWith({ direction: 'right', turnOnly: false })
    expect(onFire).toHaveBeenLastCalledWith(true)
    pointer(stick, 'pointerup', 1)
    expect(onStick).toHaveBeenLastCalledWith(IDLE_STICK)
  })
})
