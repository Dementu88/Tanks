import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { FireButton, enterLandscapeFullscreen, usePadLayout } from './PadScreen'
import TouchJoystick, { type StickSample } from './TouchJoystick'
import { DEFAULT_PROFILE, PROFILE_STORAGE, parseLabProfile } from './labProfile'
import { IDLE_INPUT, type PadInput } from './controls'
import { labSocketUrl } from './useLabHost'
import { useBodyClass } from './shared'
import './controlLab.css'

export default function ControlLabPad({ token }: { token: string }) {
  useBodyClass('party')
  useBodyClass('party-pad')
  const layout = usePadLayout()
  const [profile, setProfile] = useState(DEFAULT_PROFILE)
  const [input, setInput] = useState<PadInput>(IDLE_INPUT)
  const [ready, setReady] = useState(false)
  const [generation, setGeneration] = useState(0)
  const socket = useRef<WebSocket | null>(null)
  const held = useRef<PadInput>(IDLE_INPUT)
  const revision = useRef(-1)
  const active = useRef(false)
  const sampleTime = useRef(0)
  const send = (sample?: StickSample) => {
    if (active.current && socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(
        JSON.stringify({ t: 'input', input: held.current, revision: revision.current, sample }),
      )
  }
  const reset = () => {
    held.current = IDLE_INPUT
    setInput(IDLE_INPUT)
    setGeneration((n) => n + 1)
    send()
  }
  useEffect(() => {
    let disposed = false
    let retry = 0
    const open = () => {
      const ws = new WebSocket(labSocketUrl())
      socket.current = ws
      ws.onopen = () => ws.send(JSON.stringify({ t: 'pad', token }))
      ws.onmessage = (e) => {
        let msg
        try {
          msg = JSON.parse(e.data)
        } catch {
          return
        }
        if (msg.t === 'config') {
          const p = parseLabProfile(msg.profile)
          if (!p) return
          revision.current = msg.revision
          setProfile(p)
          reset()
        }
        if (msg.t === 'status') {
          active.current = msg.connected === true
          setReady(active.current)
          if (!active.current) {
            reset()
          }
        }
        if (msg.t === 'saved') {
          const p = parseLabProfile(msg.profile)
          if (p) {
            try {
              localStorage.setItem(PROFILE_STORAGE, JSON.stringify(p))
            } catch {
              /* plik na PC już zapisany */
            }
          }
        }
      }
      ws.onclose = (e) => {
        if (disposed) return
        active.current = false
        setReady(false)
        reset()
        if (e.code !== 4002 && e.code !== 4004) {
          if (!document.hidden) retry = window.setTimeout(open, 1000)
        }
      }
    }
    open()
    const heartbeat = window.setInterval(() => {
      if (!document.hidden) send()
    }, 200)
    const blur = () => reset()
    const hidden = () => {
      if (document.hidden) reset()
      else if (socket.current?.readyState === WebSocket.CLOSED) {
        window.clearTimeout(retry)
        open()
      }
    }
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      disposed = true
      held.current = IDLE_INPUT
      send()
      active.current = false
      window.clearTimeout(retry)
      window.clearInterval(heartbeat)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', blur)
      document.removeEventListener('visibilitychange', hidden)
      socket.current?.close()
      socket.current = null
    }
  }, [token])
  const update = (patch: Partial<PadInput>) => {
    held.current = active.current ? { ...held.current, ...patch } : IDLE_INPUT
    setInput(held.current)
    send()
  }
  return (
    <main
      className="lab-phone"
      style={
        {
          width: layout.width,
          height: layout.height,
          left: layout.rotated ? layout.height : 0,
          transform: layout.rotated ? 'rotate(90deg)' : undefined,
          transformOrigin: 'top left',
          '--phone-stick': `${Math.min(profile.stickSize, layout.height)}px`,
          '--phone-fire': `${Math.min(profile.fireSize, layout.height * 0.48)}px`,
        } as CSSProperties
      }
    >
      <button className="lab-phone-fullscreen" onClick={() => void enterLandscapeFullscreen()}>
        Pełny ekran
      </button>
      <section
        className={!ready ? 'lab-phone-controls disconnected' : 'lab-phone-controls'}
        key={generation}
      >
        <TouchJoystick
          stick={input}
          settings={profile.stick}
          rotated={layout.rotated}
          onChange={update}
          onSample={(sample) => {
            const now = performance.now()
            if (sample.event !== 'pointermove' || now - sampleTime.current >= 100) {
              sampleTime.current = now
              send(sample)
            }
          }}
        />
        <div className="lab-phone-fire">
          <FireButton
            pressed={input.fire}
            vibration={profile.stick.vibration}
            onChange={(fire) => update({ fire })}
          />
        </div>
      </section>
    </main>
  )
}
