import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { IDLE_STICK, ORIGINAL_STICK, readStick, type StickSettings, type StickState } from './stick'

export interface StickSample {
  event: string
  x: number
  y: number
  distance: number
  state: StickState
}

const DIRS = ['up', 'right', 'down', 'left'] as const

export default function TouchJoystick({
  stick,
  onChange,
  rotated = false,
  turnZone,
  settings,
  onSample,
}: {
  stick: StickState
  onChange: (s: StickState) => void
  rotated?: boolean
  turnZone?: number
  settings?: StickSettings
  onSample?: (sample: StickSample) => void
}) {
  const config = settings ?? { ...ORIGINAL_STICK, turnZone: turnZone ?? ORIGINAL_STICK.turnZone }
  const ref = useRef<HTMLDivElement>(null)
  const pointer = useRef<number | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const current = useRef(IDLE_STICK)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [center, setCenter] = useState({ x: 50, y: 50 })
  const callbacks = useRef({ onChange, onSample })
  callbacks.current = { onChange, onSample }

  const reset = (event: string) => {
    const id = pointer.current
    pointer.current = null
    if (id != null && ref.current?.hasPointerCapture(id)) ref.current.releasePointerCapture(id)
    current.current = IDLE_STICK
    setKnob({ x: 0, y: 0 })
    setCenter({ x: 50, y: 50 })
    callbacks.current.onChange(IDLE_STICK)
    if (id != null)
      callbacks.current.onSample?.({ event, x: 0, y: 0, distance: 0, state: IDLE_STICK })
  }
  const resetRef = useRef(reset)
  resetRef.current = reset
  useEffect(() => {
    const blur = () => resetRef.current('blur')
    const resize = () => resetRef.current('resize')
    const hidden = () => {
      if (document.hidden) resetRef.current('hidden')
    }
    window.addEventListener('blur', blur)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])
  useEffect(() => {
    resetRef.current('settings')
  }, [
    config.deadZone,
    config.turnZone,
    config.directionMargin,
    config.modeMargin,
    config.sensitivity,
    config.floating,
    config.vibration,
    rotated,
  ])

  const update = (e: ReactPointerEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    const sx = (e.clientX - origin.current.x) / (rect.width / 2)
    const sy = (e.clientY - origin.current.y) / (rect.height / 2)
    const x = rotated ? sy : sx
    const y = rotated ? -sx : sy
    const next = readStick(x, y, current.current, config)
    setKnob({
      x: Math.max(-0.8, Math.min(0.8, x * config.sensitivity)),
      y: Math.max(-0.8, Math.min(0.8, y * config.sensitivity)),
    })
    const previous = current.current
    if (next.direction !== previous.direction || next.turnOnly !== previous.turnOnly) {
      current.current = next
      if (next.direction != null && next.direction !== previous.direction && config.vibration > 0) {
        try {
          navigator.vibrate?.(config.vibration)
        } catch {
          /* opcjonalne */
        }
      }
      callbacks.current.onChange(next)
    }
    callbacks.current.onSample?.({
      event: e.type,
      x,
      y,
      distance: Math.max(Math.abs(x), Math.abs(y)) * config.sensitivity,
      state: next,
    })
  }
  const release = (e: ReactPointerEvent) => {
    if (e.pointerId === pointer.current) reset(e.type)
  }
  const inner = config.turnZone * 50
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Joystick dotykowy"
      className={`pad-ctrl pad-stick ${stick.direction ? 'active' : ''} ${stick.turnOnly ? 'turning' : ''}`}
      onPointerDown={(e) => {
        if (pointer.current != null || e.button !== 0) return
        e.preventDefault()
        pointer.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        const rect = e.currentTarget.getBoundingClientRect()
        origin.current = config.floating
          ? { x: e.clientX, y: e.clientY }
          : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        if (config.floating) {
          const sx = ((e.clientX - rect.left) / rect.width) * 100
          const sy = ((e.clientY - rect.top) / rect.height) * 100
          setCenter(rotated ? { x: sy, y: 100 - sx } : { x: sx, y: sy })
        }
        update(e)
      }}
      onPointerMove={(e) => {
        if (e.pointerId === pointer.current) update(e)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <rect x="0.5" y="0.5" width="99" height="99" className="hud-square" />
        <g transform={`translate(${center.x - 50} ${center.y - 50})`}>
          {DIRS.map((d, i) => (
            <g key={d} transform={`rotate(${i * 90} 50 50)`}>
              <polygon
                points={`0.5,0.5 99.5,0.5 ${50 + inner},${50 - inner} ${50 - inner},${50 - inner}`}
                className={`hud-quad ${stick.direction === d && !stick.turnOnly ? 'on' : ''}`}
              />
              <path
                d="M50 5 l4 4.4 h-8z"
                className={`hud-arrow ${stick.direction === d ? 'on' : ''}`}
              />
            </g>
          ))}
          <rect
            x={50 - inner}
            y={50 - inner}
            width={inner * 2}
            height={inner * 2}
            className="hud-turn-ring"
          />
          <rect
            x={50 - config.deadZone * 50}
            y={50 - config.deadZone * 50}
            width={config.deadZone * 100}
            height={config.deadZone * 100}
            fill="#080808"
            stroke="#777"
            strokeWidth="0.4"
          />
          <g transform={`translate(${knob.x * 50} ${knob.y * 50})`}>
            <circle cx="50" cy="50" r="13" className="hud-knob" />
            <circle cx="50" cy="50" r="8.5" className="hud-knob-inner" />
            <path d="M50 44v12M44 50h12" className="hud-cross" />
          </g>
        </g>
      </svg>
      <span className="pad-label">
        {stick.direction == null ? 'STOP' : stick.turnOnly ? 'OBRÓT' : 'JAZDA'}
      </span>
    </div>
  )
}
