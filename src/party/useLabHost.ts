import { useEffect, useRef, useState } from 'react'
import { IDLE_INPUT, type PadInput } from './controls'
import { parseLabProfile, type LabProfile } from './labProfile'
import type { StickSample } from './TouchJoystick'

export function labEndpoint(): string {
  return `${location.pathname.replace(/[^/]*$/, '')}control-lab`
}
export function labSocketUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${labEndpoint()}`
}
function hostKey(): string {
  try {
    const saved = sessionStorage.getItem('control-lab-host')
    if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved
  } catch {
    /* prywatne okno */
  }
  const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('')
  try {
    sessionStorage.setItem('control-lab-host', key)
  } catch {
    /* prywatne okno */
  }
  return key
}
export function useLabHost(
  enabled: boolean,
  profile: LabProfile,
  handlers: {
    onInput: (input: PadInput, sample?: StickSample) => void
    onLoaded: (profile: LabProfile) => void
    onSaved: (profile: LabProfile) => void
    onStatus: (message: string) => void
  },
) {
  const socket = useRef<WebSocket | null>(null)
  const latest = useRef({ profile, handlers })
  latest.current = { profile, handlers }
  const [connected, setConnected] = useState(false)
  const [padConnected, setPadConnected] = useState(false)
  const [token, setToken] = useState('')
  const [addresses, setAddresses] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef(0)
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let retry = 0
    const key = hostKey()
    const open = () => {
      const ws = new WebSocket(labSocketUrl())
      socket.current = ws
      ws.onopen = () => ws.send(JSON.stringify({ t: 'host', key, profile: latest.current.profile }))
      ws.onmessage = (e) => {
        let msg
        try {
          msg = JSON.parse(e.data)
        } catch {
          return
        }
        if (msg.t === 'joined') {
          setConnected(true)
          setError('')
          setToken(msg.token)
        }
        if (msg.t === 'status') setPadConnected(msg.connected === true)
        if (msg.t === 'input') latest.current.handlers.onInput(msg.input, msg.sample ?? undefined)
        if (msg.t === 'loaded' || msg.t === 'saved') {
          const p = parseLabProfile(msg.profile)
          if (p) {
            if (msg.t === 'loaded') latest.current.handlers.onLoaded(p)
            else {
              setSaving(false)
              window.clearTimeout(saveTimer.current)
              latest.current.handlers.onSaved(p)
            }
          }
        }
        if (msg.t === 'error') {
          setSaving(false)
          window.clearTimeout(saveTimer.current)
          latest.current.handlers.onStatus(msg.message)
        }
      }
      ws.onclose = (event) => {
        if (disposed) return
        setConnected(false)
        setPadConnected(false)
        setSaving(false)
        window.clearTimeout(saveTimer.current)
        latest.current.handlers.onInput(IDLE_INPUT)
        setError(
          event.code === 4002
            ? 'Panel otwarty w innej karcie. Odśwież, aby przejąć.'
            : 'Brak połączenia z lokalnym serwerem poligonu. Ponawiam…',
        )
        if (event.code !== 4002) retry = window.setTimeout(open, 1000)
      }
    }
    open()
    const abort = new AbortController()
    void fetch(`${labEndpoint()}/addresses`, { signal: abort.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!disposed && Array.isArray(data.addresses))
          setAddresses(
            data.addresses.filter(
              (v: unknown) => typeof v === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(v),
            ),
          )
      })
      .catch(() => {})
    return () => {
      disposed = true
      window.clearTimeout(retry)
      window.clearTimeout(saveTimer.current)
      abort.abort()
      socket.current?.close()
      socket.current = null
      setConnected(false)
      setPadConnected(false)
      setToken('')
      setSaving(false)
    }
  }, [enabled])
  const send = (message: unknown) => {
    if (socket.current?.readyState !== WebSocket.OPEN || !connected) return false
    socket.current.send(JSON.stringify(message))
    return true
  }
  const profileJSON = JSON.stringify(profile)
  useEffect(() => {
    send({ t: 'profile', profile: latest.current.profile })
  }, [profileJSON, connected])
  return {
    connected,
    padConnected,
    token,
    addresses,
    error,
    saving,
    stop: () => send({ t: 'stop' }),
    load: () => send({ t: 'load' }),
    save: () => {
      if (!send({ t: 'save', profile: latest.current.profile })) return false
      setSaving(true)
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        setSaving(false)
        latest.current.handlers.onStatus('Brak potwierdzenia zapisu. Spróbuj ponownie.')
      }, 5000)
      return true
    },
  }
}
