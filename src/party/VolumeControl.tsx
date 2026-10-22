import { useState } from 'react'
import audio, { VOLUME_LEVELS, type VolumeLevel } from '../audio/AudioManager'

export default function VolumeControl({
  muted = false,
  floating = false,
}: {
  muted?: boolean
  floating?: boolean
}) {
  const [level, setLevel] = useState(audio.volumeLevel)
  return (
    <div
      className={`tv-controls tv-volume${floating ? ' tv-volume-floating' : ''}`}
      role="group"
      aria-label="Głośność"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="tv-muted">Głośność:</span>
      {(Object.keys(VOLUME_LEVELS) as VolumeLevel[]).map((value) => (
        <button
          key={value}
          type="button"
          className={`tv-toggle${level === value ? ' on' : ''}`}
          aria-pressed={level === value}
          disabled={muted}
          title={`${Math.round(VOLUME_LEVELS[value] * 100)}%`}
          onClick={(e) => {
            audio.setVolumeLevel(value)
            setLevel(value)
            void audio.unlock().catch(() => {})
            if (e.detail > 0) e.currentTarget.blur()
          }}
        >
          {value}
        </button>
      ))}
      {muted && <span className="tv-muted">Ten ekran jest wyciszony (?mute).</span>}
    </div>
  )
}
