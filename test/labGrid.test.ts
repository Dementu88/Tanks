import { describe, expect, it } from 'vitest'
import { ControlLabSimulation, DEFAULT_LAB_GRID } from '../src/party/ControlLabSimulation'

const grid = { ...DEFAULT_LAB_GRID, enabled: true }

describe('poligon: siatka komórek', () => {
  it('ruch co komórkę: czołg staje tylko na wielokrotnościach 2 px, a średnia prędkość zostaje', () => {
    const free = new ControlLabSimulation(false)
    const sim = new ControlLabSimulation(false)
    sim.setGrid(grid)
    for (const s of [free, sim]) s.setInput({ direction: 'up', turnOnly: false, fire: false })
    for (let i = 0; i < 90; i++) {
      free.step()
      sim.step()
      expect(sim.tank.y % 2).toBe(0)
    }
    expect(Math.abs(sim.tank.y - free.tank.y)).toBeLessThan(2)
  })

  it('obszar dmg 8 komórek wycina w cegłach przejazd na szerokość czołgu', () => {
    const sim = new ControlLabSimulation(true)
    sim.setGrid(grid)
    // pod cegłami (wiersz 3, kolumny 3–9), lufa w górę
    sim.tank.x = sim.tank.rx = 98
    sim.tank.y = sim.tank.ry = 64
    sim.tank.direction = 'up'
    const map = sim.scene.map
    for (let i = 0; i < 200; i++) {
      sim.setInput({ direction: null, turnOnly: false, fire: i % 25 < 2 })
      sim.step()
    }
    const above = { x: 98, y: 48, width: 16, height: 16 }
    expect(map.brickIndicesIn(above).filter((t) => map.bricks[t])).toHaveLength(0)
    sim.setInput({ direction: 'up', turnOnly: false, fire: false })
    for (let i = 0; i < 60; i++) sim.step()
    expect(sim.tank.y).toBeLessThan(48)
  })

  it('bez fizyki siatki poligon działa jak gra (obszar niszczenia z oryginału)', () => {
    const sim = new ControlLabSimulation(false)
    expect(sim.damage()).toBeNull()
    sim.setGrid(grid)
    expect(sim.damage()).toEqual({ width: 16, depth: 4 })
  })
})
