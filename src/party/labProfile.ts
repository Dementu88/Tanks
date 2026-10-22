import { ORIGINAL_STICK, type StickSettings } from './stick'
import { GAMEPLAY } from '../engine/gameplayConfig'

export interface LabPreview {
  rank: number
  speed: number
  fire: number
  armor: number
}
export const DEFAULT_PREVIEW: LabPreview = {
  rank: GAMEPLAY.playerStartRank,
  speed: GAMEPLAY.xpStartLevels.speed,
  fire: GAMEPLAY.xpStartLevels.fire,
  armor: GAMEPLAY.xpStartLevels.armor,
}

export interface LabProfile {
  version: 1
  stick: StickSettings
  stickSize: number
  fireSize: number
  turnSnap: number
  inputFrames: number
  preview: LabPreview
}
export const PROFILE_STORAGE = 'party-control-lab-profile-v1'
export const DEFAULT_PROFILE: LabProfile = {
  version: 1,
  stick: { ...ORIGINAL_STICK },
  stickSize: 260,
  fireSize: 120,
  turnSnap: 8,
  inputFrames: 0,
  preview: { ...DEFAULT_PREVIEW },
}

export function parseLabProfile(value: unknown): LabProfile | null {
  if (value == null || typeof value !== 'object') return null
  const p = value as LabProfile
  const turnSnap = p.turnSnap === undefined ? 8 : p.turnSnap
  const inputFrames = p.inputFrames === undefined ? 0 : p.inputFrames
  const preview = p.preview ?? DEFAULT_PREVIEW
  if (
    !Number.isInteger(preview.rank) ||
    preview.rank < 1 ||
    preview.rank > 5 ||
    !(['speed', 'fire', 'armor'] as const).every(
      (key) =>
        Number.isInteger(preview[key]) && preview[key] >= 0 && preview[key] <= GAMEPLAY.xpMaxLevel,
    )
  )
    return null
  if (!Number.isInteger(inputFrames) || inputFrames < 0 || inputFrames > 12) return null
  if (!Number.isInteger(turnSnap) || turnSnap < 0 || turnSnap > 32 || turnSnap % 4 !== 0)
    return null
  if (
    p.version !== 1 ||
    p.stick == null ||
    typeof p.stick !== 'object' ||
    typeof p.stick.floating !== 'boolean'
  )
    return null
  const ranges: [keyof Omit<StickSettings, 'floating'>, number, number][] = [
    ['deadZone', 0.02, 0.24],
    ['turnZone', 0.25, 0.75],
    ['directionMargin', 0, 0.5],
    ['modeMargin', 0, 0.15],
    ['sensitivity', 0.5, 2.5],
    ['vibration', 0, 30],
  ]
  for (const [key, min, max] of ranges) {
    if (!Number.isFinite(p.stick[key]) || p.stick[key] < min || p.stick[key] > max) return null
  }
  if (
    !Number.isFinite(p.stickSize) ||
    p.stickSize < 140 ||
    p.stickSize > 1000 ||
    !Number.isFinite(p.fireSize) ||
    p.fireSize < 70 ||
    p.fireSize > 180
  )
    return null
  return {
    version: 1,
    stick: {
      deadZone: p.stick.deadZone,
      turnZone: p.stick.turnZone,
      directionMargin: p.stick.directionMargin,
      modeMargin: p.stick.modeMargin,
      sensitivity: p.stick.sensitivity,
      vibration: p.stick.vibration,
      floating: p.stick.floating,
    },
    stickSize: p.stickSize,
    fireSize: p.fireSize,
    turnSnap,
    inputFrames,
    preview: { rank: preview.rank, speed: preview.speed, fire: preview.fire, armor: preview.armor },
  }
}

export function readSavedLabProfile(): LabProfile {
  try {
    const saved = parseLabProfile(JSON.parse(localStorage.getItem(PROFILE_STORAGE) ?? 'null'))
    if (saved) return saved
    const legacy = JSON.parse(localStorage.getItem('party-control-lab-v1') ?? 'null')
    return parseLabProfile({ ...DEFAULT_PROFILE, stick: legacy }) ?? DEFAULT_PROFILE
  } catch {
    return DEFAULT_PROFILE
  }
}
