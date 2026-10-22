import { describe, expect, it } from 'vitest'
import { ControlLabSimulation } from '../src/party/ControlLabSimulation'
import { IDLE_INPUT } from '../src/party/controls'
import { parseHash } from '../src/ui/router'
import { canTankMove } from '../src/engine/physics/collision'
import { CONTROL_LAB_MAZE } from '../src/party/controlLabMap'
import { N_MAP } from '../src/engine/constants'
import { DEFAULT_PROFILE, parseLabProfile } from '../src/party/labProfile'
import { moveSpeed, bulletInterval } from '../src/engine/values'
import { playerStats } from '../src/engine/tankStats'

describe('lokalny poligon sterowania', () => {
  it('podgląd poziomu i XP zmienia prawdziwy ruch, strzały i HP bez wrogów i tarczy', () => {
    const sim = new ControlLabSimulation(false)
    sim.setPreview({ rank: 4, speed: 2, fire: 3, armor: 2 })
    expect(sim.tank.rank).toBe(4)
    expect(moveSpeed(sim.tank)).toBeCloseTo(playerStats(4).moveSpeed * 1.2)
    expect(bulletInterval(sim.tank)).toBeCloseTo(playerStats(4).fireInterval / 1.45)
    expect(sim.tank.hp).toBe(3)
    sim.setInput({ direction: 'up', fire: true, turnOnly: false })
    const before = sim.tank.y
    sim.step()
    expect(before - sim.tank.y).toBeCloseTo((playerStats(4).moveSpeed * 1.2 * 1000) / 60)
    expect(sim.scene.bullets[0].power).toBe(3)
    sim.previewHit()
    sim.step()
    expect(sim.tank.hp).toBe(2)
    sim.previewHit()
    sim.previewHit()
    expect(sim.tank.hp).toBe(1)
    expect(sim.tank.alive).toBe(true)
    sim.repairArmor()
    expect(sim.tank.hp).toBe(3)
    sim.setPreview({ rank: 1, speed: 0, fire: 0, armor: 0 })
    expect(sim.tank.hp).toBe(1)
    expect(sim.tank.helmetDuration).toBe(0)
    expect(sim.scene.remainingBotCount).toBe(0)
    expect(sim.scene.bullets).toHaveLength(0)
  })
  it('zapisuje podgląd poziomów i uzupełnia stare profile bez podglądu', () => {
    const { preview: _, ...legacy } = DEFAULT_PROFILE
    expect(parseLabProfile(legacy)?.preview).toEqual(DEFAULT_PROFILE.preview)
    const profile = { ...DEFAULT_PROFILE, preview: { rank: 5, speed: 1, fire: 2, armor: 3 } }
    expect(parseLabProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile)
    expect(parseLabProfile({ ...profile, preview: { ...profile.preview, rank: 6 } })).toBeNull()
    expect(parseLabProfile({ ...profile, preview: { ...profile.preview, armor: -1 } })).toBeNull()
  })
  it('filtr czeka N kroków, odrzuca krótkie zmiany i działa razem z siatką', () => {
    const sim = new ControlLabSimulation(false)
    sim.setTurnSnap(16)
    sim.setInputFrames(3)
    sim.tank.x = 105
    sim.tank.direction = 'right'
    sim.setInput({ direction: 'left', turnOnly: false, fire: false })
    sim.step()
    sim.step()
    expect(sim.tank.direction).toBe('right')
    expect(sim.tank.x).toBe(105)
    sim.setInput({ direction: 'up', turnOnly: false, fire: false })
    for (let i = 0; i < 3; i++) {
      sim.step()
      expect(sim.waitingForInput).toBe(true)
      expect(sim.tank.direction).toBe('right')
    }
    sim.step()
    expect(sim.waitingForInput).toBe(false)
    expect(sim.tank.direction).toBe('up')
    expect(sim.tank.x).toBe(112)
    sim.step()
    expect(sim.tank.y).toBeCloseTo(159.25)
    sim.setInput(IDLE_INPUT)
    sim.step()
    expect(sim.tank.y).toBeCloseTo(159.25)
  })
  it('puszczenie nawet między krokami i STOP kasują oczekujący ruch', () => {
    const sim = new ControlLabSimulation(false)
    sim.setInputFrames(2)
    const up = { direction: 'up', turnOnly: false, fire: false } as const
    sim.setInput(up)
    sim.step()
    sim.step()
    sim.setInput(IDLE_INPUT)
    sim.setInput(up)
    sim.step()
    expect(sim.tank.y).toBe(160)
    sim.stop()
    for (let i = 0; i < 10; i++) sim.step()
    expect(sim.tank.y).toBe(160)
    expect(sim.waitingForInput).toBe(false)
  })
  it('filtr nie opóźnia strzału i nie liczy ponownie przy zmianie samego ognia', () => {
    let shots = 0
    const sim = new ControlLabSimulation(false, (event) => {
      if (event.type === 'shot') shots++
    })
    sim.setInputFrames(2)
    sim.setInput({ direction: 'up', turnOnly: false, fire: false })
    sim.step()
    sim.setInput({ direction: 'up', turnOnly: false, fire: true })
    sim.step()
    expect(shots).toBe(1)
    expect(sim.tank.y).toBe(160)
    sim.step()
    expect(sim.tank.y).toBeCloseTo(159.25)
    sim.setInput({ direction: 'up', turnOnly: true, fire: false })
    for (let i = 0; i < 5; i++) sim.step()
    expect(sim.tank.y).toBeCloseTo(159.25)
  })
  it('filtr jest domyślnie wyłączony w starych profilach i walidowany w nowych', () => {
    const { inputFrames: _, ...legacy } = DEFAULT_PROFILE
    expect(parseLabProfile(legacy)?.inputFrames).toBe(0)
    expect(parseLabProfile({ ...legacy, inputFrames: 12 })?.inputFrames).toBe(12)
    for (const inputFrames of [-1, 0.5, 13, null, '3', NaN])
      expect(parseLabProfile({ ...legacy, inputFrames })).toBeNull()
  })
  it.each([
    [0, 105],
    [4, 104],
    [8, 104],
    [16, 112],
    [32, 96],
  ])('siatka %i px wyrównuje skręt do %i, bez zmiany prędkości jazdy', (grid, expected) => {
    const sim = new ControlLabSimulation(false)
    sim.setTurnSnap(grid)
    sim.tank.x = 105
    sim.tank.direction = 'right'
    sim.setInput({ direction: 'up', turnOnly: true, fire: false })
    sim.step()
    expect(sim.tank.x).toBe(expected)
    expect(sim.tank.y).toBe(160)
    sim.setInput({ direction: 'up', turnOnly: false, fire: false })
    sim.step()
    expect(sim.tank.y).toBeCloseTo(159.25)
    sim.stop()
    sim.step()
    expect(sim.tank.y).toBeCloseTo(159.25)
  })
  it('duża siatka nie wpycha czołgu w połówki ścian ani przez nie', () => {
    const sim = new ControlLabSimulation(false)
    sim.setTurnSnap(32)
    // Korytarz 16 px między x=88 i x=104; żadna linia siatki 32 px tu nie pasuje.
    for (const col of [10, 13]) sim.scene.map.steels[20 * N_MAP.STEEL + col] = true
    sim.tank.x = 88
    sim.tank.direction = 'right'
    sim.setInput({ direction: 'up', turnOnly: true, fire: false })
    sim.step()
    expect(sim.tank.x).toBe(88)
    expect(sim.tank.direction).toBe('up')
    expect(
      canTankMove({ map: sim.scene.map, tanks: sim.scene.tanks, restrictedAreas: [] }, sim.tank),
    ).toBe(true)
  })
  it('stary profil zachowuje siatkę 8 px, nowy zapisuje wybór i odrzuca błędne wartości', () => {
    const { turnSnap: _, ...legacy } = DEFAULT_PROFILE
    expect(parseLabProfile(legacy)?.turnSnap).toBe(8)
    expect(parseLabProfile({ ...legacy, turnSnap: 0 })?.turnSnap).toBe(0)
    expect(parseLabProfile({ ...legacy, turnSnap: 16 })?.turnSnap).toBe(16)
    for (const turnSnap of [-4, 3, 36, null, '8', NaN])
      expect(parseLabProfile({ ...legacy, turnSnap })).toBeNull()
  })
  it('działa bez wrogów i nie kończy treningu po wyczyszczeniu planszy', () => {
    const sim = new ControlLabSimulation(false)
    for (let i = 0; i < 3600; i++) sim.step()
    expect(sim.scene.tanks).toHaveLength(1)
    expect(sim.scene.remainingBotCount).toBe(0)
    expect(sim.scene.flickers).toHaveLength(0)
    expect(sim.tank.alive).toBe(true)
    sim.setInput({ direction: 'right', turnOnly: false, fire: false })
    for (let i = 0; i < 20; i++) sim.step()
    expect(sim.tank.x).toBeGreaterThan(96)
  })
  it('obrót nie powoduje jazdy, puszczenie zatrzymuje, kolizje działają jak w grze', () => {
    const sim = new ControlLabSimulation(true)
    sim.setInput({ direction: 'left', turnOnly: true, fire: false })
    for (let i = 0; i < 20; i++) sim.step()
    expect(sim.tank.direction).toBe('left')
    expect(sim.tank.x).toBe(96)
    sim.setInput({ direction: 'up', turnOnly: false, fire: false })
    for (let i = 0; i < 300; i++) sim.step()
    expect(sim.tank.y).toBeGreaterThanOrEqual(96)
    expect(sim.tank.y).toBeLessThan(100)
    sim.stop()
    const position = [sim.tank.x, sim.tank.y]
    for (let i = 0; i < 30; i++) sim.step()
    expect([sim.tank.x, sim.tank.y]).toEqual(position)
  })
  it('krótki strzał między krokami silnika nie ginie, STOP czyści oczekujący strzał', () => {
    let shots = 0
    const sim = new ControlLabSimulation(false, (event) => {
      if (event.type === 'shot') shots++
    })
    sim.setInput({ ...IDLE_INPUT, fire: true })
    sim.setInput(IDLE_INPUT)
    sim.step()
    expect(shots).toBe(1)
    sim.setInput({ ...IDLE_INPUT, fire: true })
    sim.stop()
    for (let i = 0; i < 120; i++) sim.step()
    expect(shots).toBe(1)
  })
  it('ma osobny adres', () => {
    expect(parseHash('#/sterowanie')).toEqual({ screen: 'control-lab' })
    expect(parseHash('#/test')).toEqual({ screen: 'party-test' })
    expect(parseHash('#/sterowanie-pad/abc')).toEqual({ screen: 'control-lab-pad', token: 'abc' })
  })
  it('labirynt ma prawdziwe połówki kolizji i przejezdną trasę do górnej alejki', () => {
    expect(CONTROL_LAB_MAZE.some((row) => row.includes('T3'))).toBe(true)
    const sim = new ControlLabSimulation(true)
    const world = { map: sim.scene.map, tanks: sim.scene.tanks, restrictedAreas: [] }
    const fits = (x: number, y: number) => {
      sim.tank.x = x
      sim.tank.y = y
      return canTankMove(world, sim.tank)
    }
    expect(fits(48, 104)).toBe(false)
    expect(fits(56, 104)).toBe(true)
    const queue: [number, number][] = [[96, 160]]
    const visited = new Set(['96,160'])
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i]
      for (const [nx, ny] of [
        [x + 8, y],
        [x - 8, y],
        [x, y + 8],
        [x, y - 8],
      ]) {
        if (visited.has(`${nx},${ny}`) || !fits(nx, ny)) continue
        visited.add(`${nx},${ny}`)
        queue.push([nx, ny])
      }
    }
    expect(visited.has('160,16')).toBe(true)
    expect(visited.has('16,32')).toBe(true)
  })
})
