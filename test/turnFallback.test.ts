import { describe, expect, it } from 'vitest'
import { N_MAP } from '../src/engine/constants'
import { ControlLabSimulation } from '../src/party/ControlLabSimulation'

describe('wyrównanie skrętu z pada', () => {
  // korytarz 16 px między stalą (x 80–88 i 104–112) w wierszu y=160–168, czołg pod nim mija go o 3 px
  it.each([0, 16, 32])('siatka %i px nie zostawia czołgu przed przejściem', (grid) => {
    const sim = new ControlLabSimulation(false)
    sim.setTurnSnap(grid)
    for (const col of [10, 13]) sim.scene.map.steels[20 * N_MAP.STEEL + col] = true
    sim.tank.x = sim.tank.rx = 91
    sim.tank.y = sim.tank.ry = 168
    sim.tank.direction = 'right'
    sim.setInput({ direction: 'up', turnOnly: false, fire: false })
    for (let i = 0; i < 10; i++) sim.step()
    expect(sim.tank.direction).toBe('up')
    expect(sim.tank.x).toBe(88)
    expect(sim.tank.y).toBeLessThan(168)
  })
})
