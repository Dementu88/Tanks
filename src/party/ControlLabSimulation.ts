import BattleScene from '../engine/BattleScene'
import { STEP_MS } from '../engine/Game'
import type { PlayerState } from '../engine/GameSession'
import TerrainMap from '../engine/map/TerrainMap'
import type { GameEvent } from '../engine/events'
import { HostInput, REMOTE_CONTROL } from '../lan/input'
import { IDLE_INPUT, type PadInput } from './controls'
import { CONTROL_LAB_MAZE } from './controlLabMap'
import { alignTurn, validTurnSnap } from '../engine/physics/turnAlignment'
import { isPerpendicular } from '../engine/physics/geometry'
import { bonusesFor, DEFAULT_XP_CONFIG, type SessionBonuses } from '../engine/sessionXp'
import { DEFAULT_PREVIEW, type LabPreview } from './labProfile'
import { GAMEPLAY } from '../engine/gameplayConfig'

/** Ten sam ruch, kolizje i strzały co w grze, bez sieci i przechodzenia do kolejnej rundy. */
export class ControlLabSimulation {
  readonly scene: BattleScene
  private readonly input = new HostInput()
  private held: PadInput = IDLE_INPUT
  private pendingFire = false
  private turnSnap = 8
  private inputFrames = 0
  private candidateFrames = 0
  private accepted: Pick<PadInput, 'direction' | 'turnOnly'> = IDLE_INPUT
  waitingForInput = false
  private bonuses: SessionBonuses = bonusesFor(
    { ...DEFAULT_XP_CONFIG, enabled: true },
    { bullet: 0, shield: 0, ...DEFAULT_PREVIEW },
  )

  constructor(obstacles: boolean, onEvent: (event: GameEvent) => void = () => {}) {
    const map = obstacles
      ? CONTROL_LAB_MAZE
      : Array.from({ length: 13 }, () => Array(13).fill('X').join(' '))
    const player: PlayerState = {
      id: 'control-lab',
      control: REMOTE_CONTROL,
      color: 'yellow',
      spawnPos: { x: 96, y: 160 },
      lives: 99,
      score: 0,
      reservedTankLevel: null,
      reservedRank: null,
      pilot: 'human',
      idleTime: 0,
      touchedThisStage: true,
    }
    this.scene = new BattleScene(
      TerrainMap.fromRaw({ name: 'Poligon sterowania', difficulty: 1, map, bots: [] }),
      { play: () => {} },
      [],
      [player],
      1,
      {
        autopilot: false,
        random: () => 0.5,
        events: { emit: onEvent },
        sessionBonuses: () => this.bonuses,
      },
    )
    this.scene.devSetBotsEnabled(false)
    this.scene.start()
    // Pomijamy animację narodzin, aby po resecie można było od razu testować.
    for (let i = 0; i < 120 && !this.scene.controllable(0); i++)
      this.scene.step(STEP_MS, this.input)
    this.scene.devSetInvincible(0, false)
  }

  get tank() {
    return this.scene.tanks.find((tank) => tank.side === 'player' && tank.alive)!
  }

  setInput(next: PadInput): void {
    if (next.fire && !this.held.fire) this.pendingFire = true
    if (next.direction !== this.held.direction || next.turnOnly !== this.held.turnOnly)
      this.candidateFrames = 0
    if (next.direction == null) this.resetFilter()
    this.held = { ...next }
  }

  stop(): void {
    this.held = IDLE_INPUT
    this.pendingFire = false
    this.resetFilter()
    this.input.applyRemote({ direction: null, fireHeld: false, firePressed: false })
    this.input.endTick()
  }

  setTurnSnap(pixels: number): void {
    if (!validTurnSnap(pixels)) throw new RangeError('Siatka skrętu: 0–32 px, co 4 px')
    this.turnSnap = pixels
  }

  setInputFrames(frames: number): void {
    if (!Number.isInteger(frames) || frames < 0 || frames > 12)
      throw new RangeError('Filtr wejścia: 0–12 klatek')
    this.inputFrames = frames
    this.resetFilter()
  }

  setPreview(preview: LabPreview): void {
    if (
      !Number.isInteger(preview.rank) ||
      preview.rank < 1 ||
      preview.rank > 5 ||
      !(['speed', 'fire', 'armor'] as const).every(
        (key) =>
          Number.isInteger(preview[key]) &&
          preview[key] >= 0 &&
          preview[key] <= GAMEPLAY.xpMaxLevel,
      )
    )
      throw new RangeError('Nieprawidłowy poziom podglądu poligonu')
    this.bonuses = bonusesFor(
      { ...DEFAULT_XP_CONFIG, enabled: true },
      { bullet: 0, shield: 0, ...preview },
    )
    this.scene.devSetRank(0, preview.rank)
    this.scene.refreshSessionBonuses()
    this.tank.cooldown = 0
    this.scene.bullets.length = 0
  }

  previewHit(): void {
    this.tank.hp = Math.max(1, this.tank.hp - 1)
  }

  repairArmor(): void {
    this.tank.hp = this.tank.maxHp
  }

  private resetFilter(): void {
    this.accepted = IDLE_INPUT
    this.candidateFrames = 0
    this.waitingForInput = false
  }

  private filteredMovement(): Pick<PadInput, 'direction' | 'turnOnly'> {
    const { direction, turnOnly } = this.held
    this.waitingForInput = false
    if (direction == null) return IDLE_INPUT
    if (direction === this.accepted.direction && turnOnly === this.accepted.turnOnly)
      return this.accepted
    if (this.candidateFrames < this.inputFrames) {
      this.candidateFrames++
      this.waitingForInput = true
      // W oczekiwaniu na nowy kierunek nie jedziemy dalej w poprzednim.
      return IDLE_INPUT
    }
    this.accepted = { direction, turnOnly }
    return this.accepted
  }

  step(): void {
    const { direction, turnOnly } = this.filteredMovement()
    const { fire } = this.held
    if (direction != null && isPerpendicular(direction, this.tank.direction))
      alignTurn(
        { map: this.scene.map, tanks: this.scene.tanks, restrictedAreas: [] },
        this.tank,
        this.turnSnap,
        direction,
      )
    this.input.applyRemote({
      direction: turnOnly && direction === this.tank.direction ? null : direction,
      fireHeld: fire,
      firePressed: this.pendingFire,
    })
    this.pendingFire = false
    this.scene.step(STEP_MS, this.input)
    this.input.endTick()
  }
}
