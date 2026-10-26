import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArrowPad from '../src/party/ArrowPad'
import { FireButton } from '../src/party/PadScreen'
import { IDLE_STICK } from '../src/party/stick'
import { STALE_GRACE_MS } from '../src/party/touchGuard'

let root: Root
let host: HTMLDivElement

function pointer(element: Element, type: string, id: number) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerId: id, clientX: 0, clientY: 0, button: 0 })
  act(() => {
    element.dispatchEvent(event)
  })
}

/** zdarzenie touch* z listą palców (jsdom nie ma TouchEvent); palec = [id, element] */
function touch(
  type: string,
  target: Element,
  touches: [number, Element][],
  changed: [number, Element][],
) {
  const list = (items: [number, Element][]) =>
    items.map(([identifier, el]) => ({ identifier, target: el }))
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { touches: list(touches), changedTouches: list(changed) })
  act(() => {
    target.dispatchEvent(event)
  })
}

function capture(element: Element) {
  element.setPointerCapture = () => {}
  element.hasPointerCapture = () => false
  element.releasePointerCapture = () => {}
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

describe('krzyżak ze strzałek', () => {
  it('jedzie, póki trzymasz strzałkę; przesunięcie palca zmienia kierunek', () => {
    const onChange = vi.fn()
    act(() => root.render(createElement(ArrowPad, { onChange })))
    const pad = host.querySelector('.pad-arrows')!
    capture(pad)
    let under = host.querySelector('[data-dir="up"]')
    document.elementFromPoint = () => under
    pointer(pad, 'pointerdown', 1)
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'up', turnOnly: false })
    under = host.querySelector('[data-dir="right"]')
    pointer(pad, 'pointermove', 1)
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'right', turnOnly: false })
    pointer(pad, 'pointerup', 1)
    expect(onChange).toHaveBeenLastCalledWith(IDLE_STICK)
  })

  it('zgubione puszczenie palca (iOS): stoi, gdy na krzyżaku nie ma już palca', () => {
    const onChange = vi.fn()
    act(() => root.render(createElement(ArrowPad, { onChange })))
    const pad = host.querySelector('.pad-arrows')!
    capture(pad)
    document.elementFromPoint = () => host.querySelector('[data-dir="left"]')
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    pointer(pad, 'pointerdown', 1)
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'left', turnOnly: false })
    // pointerup nie przyszedł, ale ostatni palec zszedł z ekranu
    now.mockReturnValue(1000 + STALE_GRACE_MS + 1)
    touch('touchend', pad, [], [[1, pad]])
    expect(onChange).toHaveBeenLastCalledWith(IDLE_STICK)
  })
})

describe('ogień na iPhonie', () => {
  it('nie strzela bez końca po zgubionym puszczeniu; nowy palec od razu strzela', () => {
    const onChange = vi.fn()
    act(() => root.render(createElement(FireButton, { pressed: false, onChange, vibration: 0 })))
    const fire = host.querySelector('.pad-fire')!
    capture(fire)
    const other = document.createElement('div')
    document.body.appendChild(other)
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    pointer(fire, 'pointerdown', 1)
    expect(onChange).toHaveBeenLastCalledWith(true)
    // pointerup zgubiony; po chwili ten sam przycisk dotyka nowy palec (inny palec trzyma ekran gdzie indziej)
    now.mockReturnValue(1000 + STALE_GRACE_MS + 1)
    pointer(fire, 'pointerdown', 2)
    touch(
      'touchstart',
      fire,
      [
        [5, other],
        [6, fire],
      ],
      [[6, fire]],
    )
    expect(onChange).toHaveBeenLastCalledWith(true)
    pointer(fire, 'pointerup', 2)
    expect(onChange).toHaveBeenLastCalledWith(false)
    // i znowu zgubione puszczenie: wszystkie palce poza przyciskiem — puszcza się
    pointer(fire, 'pointerdown', 3)
    now.mockReturnValue(2000 + STALE_GRACE_MS)
    touch('touchend', fire, [[5, other]], [[7, fire]])
    expect(onChange).toHaveBeenLastCalledWith(false)
    other.remove()
  })
})
