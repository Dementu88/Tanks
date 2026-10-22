import { useState } from 'react'
import {
  XP_COST_MIN,
  XP_COST_MAX,
  XP_TRAITS,
  xpCost,
  type XpConfig,
  type XpState,
  type XpTrait,
} from '../engine/sessionXp'
import { sendParty } from './client'
import type { PartyRoomState } from './protocol'
import './xp.css'

const LABELS: Record<XpTrait, string> = {
  speed: 'Szybkość',
  fire: 'Szybki ogień',
  armor: 'Wytrzymałość',
  bullet: 'Szybsze pociski',
  shield: 'Dłuższa tarcza',
}

/** krótkie nazwy do paska XP na TV */
const SHORT: Record<XpTrait, string> = {
  speed: 'Szybkość',
  fire: 'Ogień',
  armor: 'Pancerz',
  bullet: 'Pociski',
  shield: 'Tarcza',
}

function benefit(state: XpState, trait: XpTrait, level: number): string {
  const c = state.config
  switch (trait) {
    case 'armor':
      return `+${level * c.armorHp} HP`
    case 'shield':
      return `+${((level * c.shieldMs) / 1000).toLocaleString('pl-PL')} s`
    case 'bullet':
      return `+${level * c.bulletPercent}%`
    default:
      return `+${level * (trait === 'speed' ? c.speedPercent : c.firePercent)}%`
  }
}

function LevelBar({ level, label, max }: { level: number; label: string; max: number }) {
  return (
    <span className="xp-level" aria-label={`${label}: poziom ${level} z ${max}`}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <i key={n} className={n <= level ? 'on' : ''} />
      ))}
    </span>
  )
}

function Setting({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="xp-setting">
      <span>
        {label}
        <b>
          {value}
          {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export default function XpPanel({ room }: { room: PartyRoomState }) {
  const xp = room.xp
  if (xp == null) return null
  const c = xp.config
  const configure = (patch: Partial<XpConfig>) =>
    sendParty({ t: 'xp-config', config: { ...c, ...patch } })
  return (
    <section
      className="xp-panel"
      aria-label="Rozwój drużyny"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="xp-heading">
        <strong>ROZWÓJ DRUŻYNY</strong>
        <b>{xp.bank} XP</b>
      </div>
      <div className="xp-toggle-row">
        <button
          type="button"
          className={c.enabled ? 'xp-toggle on' : 'xp-toggle'}
          aria-pressed={c.enabled}
          disabled={room.playing}
          onClick={() => configure({ enabled: !c.enabled })}
        >
          XP na tę sesję: {c.enabled ? 'włączone' : 'wyłączone'}
        </button>
      </div>
      <p className="xp-note">
        Wspólna pula za pokonanych wrogów. Wybierz ulepszenie dla wszystkich graczy. Postęp zostaje
        po restarcie gry; zeruje go ponowne uruchomienie serwera.
      </p>
      {c.enabled && (
        <>
          <div className="xp-traits">
            {XP_TRAITS.map((trait) => {
              const level = xp.levels[trait]
              const cost = xpCost(xp, trait)
              return (
                <div className={`xp-trait xp-${trait}`} key={trait}>
                  <div>
                    <strong>{LABELS[trait]}</strong>
                    <span>
                      LV {level}/{xp.maxLevel} · {benefit(xp, trait, level)}
                    </span>
                  </div>
                  <LevelBar level={level} label={LABELS[trait]} max={xp.maxLevel} />
                  <button
                    type="button"
                    disabled={level >= xp.maxLevel || xp.bank < cost}
                    aria-label={`Rozwiń ${LABELS[trait]} za ${cost} XP`}
                    onClick={() => sendParty({ t: 'xp-buy', trait })}
                  >
                    {level >= xp.maxLevel ? 'MAKSIMUM' : `${cost} XP`}
                  </button>
                  {level < xp.maxLevel && (
                    <small>Następny poziom: {benefit(xp, trait, level + 1)}</small>
                  )}
                </div>
              )
            })}
          </div>
          <details className="xp-settings">
            <summary>
              Przelicznik XP i premie {room.playing ? '(zmienisz przed startem)' : ''}
            </summary>
            <fieldset disabled={room.playing}>
              {XP_TRAITS.map((trait) => (
                <Setting
                  key={trait}
                  label={`${LABELS[trait]} — koszt LV1`}
                  value={c.costs[trait]}
                  min={XP_COST_MIN}
                  max={XP_COST_MAX}
                  unit=" XP"
                  onChange={(value) => configure({ costs: { ...c.costs, [trait]: value } })}
                />
              ))}
              <Setting
                label="Szybkość na poziom"
                value={c.speedPercent}
                min={5}
                max={50}
                unit="%"
                onChange={(speedPercent) => configure({ speedPercent })}
              />
              <Setting
                label="Szybkostrzelność na poziom"
                value={c.firePercent}
                min={5}
                max={50}
                unit="%"
                onChange={(firePercent) => configure({ firePercent })}
              />
              <Setting
                label="Pancerz na poziom"
                value={c.armorHp}
                min={1}
                max={3}
                unit=" HP"
                onChange={(armorHp) => configure({ armorHp })}
              />
              <Setting
                label="Pociski na poziom"
                value={c.bulletPercent}
                min={5}
                max={50}
                unit="%"
                onChange={(bulletPercent) => configure({ bulletPercent })}
              />
              <Setting
                label="Tarcza na poziom"
                value={c.shieldMs}
                min={250}
                max={5000}
                step={250}
                unit=" ms"
                onChange={(shieldMs) => configure({ shieldMs })}
              />
            </fieldset>
            <p className="xp-note">
              LV2 kosztuje 2×, LV3 3× koszt LV1. Premie sumują się. Więcej HP zmienia kolor
              pancerza; pasek nad czołgiem pokazuje pozostałe HP w kolorze gracza. Ustawienia
              zapisują się od razu na czas sesji.
            </p>
          </details>
        </>
      )}
      {!c.enabled && (
        <p className="xp-note">
          Tryb klasyczny: bez zdobywania XP i bez premii. Włączenie XP przywróci postęp tej sesji.
        </p>
      )}
    </section>
  )
}

/** Wspólny ekran umożliwia zakupy również ekipie grającej sprzętowymi padami. */
export function TvXp({ room }: { room: PartyRoomState }) {
  const [open, setOpen] = useState(false)
  const xp = room.xp
  if (xp == null || (room.playing && !xp.config.enabled)) return null
  return (
    <>
      <div className={room.playing ? 'xp-hud' : 'xp-lobby-button'}>
        {xp.config.enabled && (
          <>
            <b>{xp.bank} XP</b>
            {XP_TRAITS.map((trait) => (
              <span className={`xp-hud-trait xp-${trait}`} key={trait}>
                {SHORT[trait]}{' '}
                <LevelBar level={xp.levels[trait]} label={LABELS[trait]} max={xp.maxLevel} />
              </span>
            ))}
          </>
        )}
        <button type="button" onClick={() => setOpen(true)}>
          Rozwój XP
        </button>
      </div>
      {open && (
        <div
          className="xp-modal"
          role="dialog"
          aria-modal="true"
          aria-label="XP drużyny"
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <div className="xp-modal-content">
            <button className="xp-close" type="button" autoFocus onClick={() => setOpen(false)}>
              Zamknij
            </button>
            <XpPanel room={room} />
          </div>
        </div>
      )}
    </>
  )
}
