/**
 * Strażnik dotyku dla iPhone'a. Safari i Chrome na iOS (oba to WebKit) potrafią zgubić
 * pointerup / pointercancel, zwłaszcza przy kilku palcach. Kontrolka zostaje wtedy „wciśnięta”
 * (joystick stoi w jednym miejscu, ogień strzela bez końca), a nowe dotknięcia są odrzucane,
 * bo kontrolka myśli, że trzyma ją wcześniejszy palec.
 *
 * Zdarzenia touch* idą osobno i niosą listę palców na ekranie: gdy na kontrolce nie leży już
 * żaden palec, a ona dalej uważa się za trzymaną — ten wcześniejszy dotyk na pewno się skończył.
 */

/** świeżo zaczęty dotyk: touchstart tego samego palca może przyjść tuż po pointerdown */
export const STALE_GRACE_MS = 150

export interface StaleTouchWatch {
  /** element kontrolki */
  element: () => Element | null
  /** czas (performance.now) rozpoczęcia trzymania; null = kontrolka wolna */
  heldSince: () => number | null
  /**
   * zgubiony dotyk: zwolnij kontrolkę. `adopt` = nowy palec zaczął się na tej kontrolce
   * (jego pointerdown mógł zostać odrzucony) — trzeba go przyjąć.
   */
  release: (adopt: boolean) => void
}

const startedOn = (element: Element, touch: Touch) =>
  touch.target instanceof Node && element.contains(touch.target)

export function watchStaleTouches(watch: StaleTouchWatch): () => void {
  const start = (e: TouchEvent) => {
    const element = watch.element()
    const since = watch.heldSince()
    if (element == null || since == null || performance.now() - since < STALE_GRACE_MS) return
    const fresh = new Set(Array.from(e.changedTouches, (t) => t.identifier))
    // palce na kontrolce poza tymi, które właśnie dotknęły
    const holding = Array.from(e.touches).some(
      (t) => !fresh.has(t.identifier) && startedOn(element, t),
    )
    if (holding) return
    watch.release(Array.from(e.changedTouches).some((t) => startedOn(element, t)))
  }
  const end = (e: TouchEvent) => {
    const element = watch.element()
    if (element == null || watch.heldSince() == null) return
    if (!Array.from(e.touches).some((t) => startedOn(element, t))) watch.release(false)
  }
  const options = { capture: true, passive: true }
  document.addEventListener('touchstart', start, options)
  document.addEventListener('touchend', end, options)
  document.addEventListener('touchcancel', end, options)
  return () => {
    document.removeEventListener('touchstart', start, options)
    document.removeEventListener('touchend', end, options)
    document.removeEventListener('touchcancel', end, options)
  }
}
