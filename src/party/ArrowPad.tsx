import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Direction } from '../engine/types'
import { IDLE_STICK, type StickState } from './stick'
import { STALE_GRACE_MS, watchStaleTouches } from './touchGuard'

const ARROWS: { dir: Direction; label: string; path: string }[] = [
  { dir: 'up', label: 'Góra', path: 'M50 18 L76 50 H24 Z' },
  { dir: 'left', label: 'Lewo', path: 'M18 50 L50 24 V76 Z' },
  { dir: 'right', label: 'Prawo', path: 'M82 50 L50 24 V76 Z' },
  { dir: 'down', label: 'Dół', path: 'M50 82 L76 50 H24 Z' },
]

/** strzałka pod palcem (działa też w padzie obróconym o 90° — liczy się to, co widać) */
function arrowAt(x: number, y: number): Direction | null {
  const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-dir]')
  return (hit?.dataset.dir as Direction | undefined) ?? null
}

/**
 * Krzyżak ze strzałek zamiast joysticka: trzymasz strzałkę — czołg jedzie. Palec można przesuwać
 * ze strzałki na strzałkę bez odrywania. Kilka palców: liczy się ten, który dotknął ostatni.
 */
export default function ArrowPad({ onChange }: { onChange: (s: StickState) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  /** palce na krzyżaku: id → strzałka pod palcem i kiedy dotknął */
  const fingers = useRef(new Map<number, { dir: Direction | null; since: number }>())
  const [active, setActive] = useState<Direction | null>(null)
  const callback = useRef(onChange)
  callback.current = onChange
  const last = useRef<Direction | null>(null)

  const emit = () => {
    let dir: Direction | null = null
    for (const f of fingers.current.values()) if (f.dir != null) dir = f.dir
    if (dir === last.current) return
    last.current = dir
    setActive(dir)
    callback.current(dir == null ? IDLE_STICK : { direction: dir, turnOnly: false })
  }
  const emitRef = useRef(emit)
  emitRef.current = emit

  useEffect(() => {
    const clear = () => {
      fingers.current.clear()
      emitRef.current()
    }
    const hidden = () => {
      if (document.hidden) clear()
    }
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', hidden)
    // iOS: zgubiony pointerup — zwalniamy palce, których już nie ma na krzyżaku
    const stopGuard = watchStaleTouches({
      element: () => ref.current,
      heldSince: () => {
        let oldest: number | null = null
        for (const f of fingers.current.values()) oldest = Math.min(oldest ?? f.since, f.since)
        return oldest
      },
      release: () => {
        const now = performance.now()
        // świeży palec (jego touchstart mógł przyjść po pointerdown) zostaje
        for (const [id, f] of fingers.current) {
          if (now - f.since >= STALE_GRACE_MS) fingers.current.delete(id)
        }
        emitRef.current()
      },
    })
    return () => {
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', hidden)
      stopGuard()
    }
  }, [])

  const track = (e: ReactPointerEvent) => {
    const finger = fingers.current.get(e.pointerId)
    if (finger == null) return
    finger.dir = arrowAt(e.clientX, e.clientY)
    emit()
  }
  const release = (e: ReactPointerEvent) => {
    if (fingers.current.delete(e.pointerId)) emit()
  }

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Strzałki"
      className="pad-ctrl pad-arrows"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // bez przechwycenia też działa, tylko zjechanie z krzyżaka puszcza strzałkę
        }
        fingers.current.set(e.pointerId, {
          dir: arrowAt(e.clientX, e.clientY),
          since: performance.now(),
        })
        emit()
      }}
      onPointerMove={track}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      {ARROWS.map((a) => (
        <div
          key={a.dir}
          data-dir={a.dir}
          aria-label={a.label}
          className={`pad-arrow pad-arrow-${a.dir}${active === a.dir ? ' active' : ''}`}
        >
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <path d={a.path} />
          </svg>
        </div>
      ))}
      <span className="pad-arrows-stop">{active == null ? 'STOP' : ''}</span>
    </div>
  )
}
