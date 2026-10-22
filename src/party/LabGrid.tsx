import { useEffect, useState } from 'react'
import { Container, Graphics } from 'pixi.js'
import { BLOCK_SIZE, FIELD_SIZE, FIELD_WIDTH, ITEM_SIZE_MAP } from '../engine/constants'
import { getDirectionInfo } from '../engine/physics/geometry'
import {
  cellSize,
  DEFAULT_LAB_GRID,
  type ControlLabSimulation,
  type LabGrid,
} from './ControlLabSimulation'

/**
 * Poligon: siatka komórek (np. 8×8 w kratce), obrysy kolizji, ścian i obszaru niszczenia
 * oraz panel suwaków. Wszystko tylko w #/sterowanie — gra z rodziną tego nie używa.
 */

export interface LabOverlay {
  grid: boolean
  collision: boolean
  walls: boolean
  damage: boolean
  turn: boolean
}

export const DEFAULT_OVERLAY: LabOverlay = {
  grid: true,
  collision: true,
  walls: true,
  damage: true,
  turn: true,
}

const STORAGE = 'party-control-lab-grid-v1'

interface Saved {
  grid: LabGrid
  overlay: LabOverlay
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Partial<Saved> | null
    if (raw != null && typeof raw === 'object') {
      return {
        grid: { ...DEFAULT_LAB_GRID, ...raw.grid },
        overlay: { ...DEFAULT_OVERLAY, ...raw.overlay },
      }
    }
  } catch {
    // brak albo zepsuty zapis
  }
  return { grid: { ...DEFAULT_LAB_GRID }, overlay: { ...DEFAULT_OVERLAY } }
}

/** ustawienia siatki i obrysów, zapamiętywane w przeglądarce */
export function useLabGrid() {
  const [state, setState] = useState(load)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(state))
    } catch {
      // prywatne okno
    }
  }, [state])
  return {
    grid: state.grid,
    overlay: state.overlay,
    setGrid: (patch: Partial<LabGrid>) =>
      setState((s) => {
        const grid = { ...s.grid, ...patch }
        // wyrównanie i obszar niszczenia nie mogą przekroczyć nowego podziału
        grid.turnCells = Math.min(grid.turnCells, grid.divisions * 2)
        grid.damageWidth = Math.min(Math.max(1, grid.damageWidth), grid.divisions * 2)
        grid.damageDepth = Math.min(grid.damageDepth, grid.divisions)
        return { ...s, grid }
      }),
    setOverlay: (patch: Partial<LabOverlay>) =>
      setState((s) => ({ ...s, overlay: { ...s.overlay, ...patch } })),
    reset: () => setState({ grid: { ...DEFAULT_LAB_GRID }, overlay: { ...DEFAULT_OVERLAY } }),
  }
}

const px = (cells: number, grid: LabGrid) =>
  `${(cells * cellSize(grid)).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} px`

function Slider({
  id,
  label,
  value,
  min,
  max,
  output,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  output: string
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <label className="lab-slider" htmlFor={id}>
      <span>
        {label}
        <output>{output}</output>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

const LEGEND: [string, string][] = [
  ['#3dff8a', 'kolizja czołgu 16 × 16'],
  ['#ffd23d', 'miejsce zarezerwowane do skrętu'],
  ['#ff4dd8', 'linie, do których wyrówna skręt'],
  ['#ff8a2a', 'obszar niszczenia pocisku'],
  ['#ff3b3b', 'cegły'],
  ['#8fb4ff', 'stal'],
  ['#3ddcff', 'woda'],
]

export function LabGridPanel({ lab }: { lab: ReturnType<typeof useLabGrid> }) {
  const { grid, overlay, setGrid, setOverlay } = lab
  const cell = cellSize(grid)
  const toggles: [keyof LabOverlay, string][] = [
    ['grid', 'Siatka'],
    ['collision', 'Kolizja'],
    ['walls', 'Ściany'],
    ['damage', 'Obszar dmg'],
    ['turn', 'Linie skrętu'],
  ]
  return (
    <details className="lab-preview lab-grid-panel" open>
      <summary>Siatka i obrysy</summary>
      <p>
        Kratka (16 px) dzieli się na {grid.divisions} × {grid.divisions} komórek — jedna komórka to{' '}
        {cell.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} px. Komórka jest najmniejszym
        krokiem ruchu, wyrównania skrętu i niszczenia. Działa tylko w poligonie.
      </p>
      <div className="lab-presets">
        <button aria-pressed={grid.enabled} onClick={() => setGrid({ enabled: !grid.enabled })}>
          Fizyka siatki: {grid.enabled ? 'włączona' : 'wyłączona (jak gra)'}
        </button>
        <button onClick={lab.reset}>Domyślne</button>
      </div>
      <div className="lab-presets">
        {toggles.map(([key, label]) => (
          <button
            key={key}
            aria-pressed={overlay[key]}
            onClick={() => setOverlay({ [key]: !overlay[key] })}
          >
            {label}
          </button>
        ))}
      </div>
      <Slider
        id="lab-grid-div"
        label="Podział kratki"
        value={grid.divisions}
        min={1}
        max={16}
        output={`${grid.divisions} × ${grid.divisions} · komórka ${px(1, grid)}`}
        onChange={(divisions) => setGrid({ divisions })}
      />
      <div className="lab-presets">
        <button
          aria-pressed={grid.quantizeMove}
          disabled={!grid.enabled}
          onClick={() => setGrid({ quantizeMove: !grid.quantizeMove })}
        >
          Ruch co komórkę: {grid.quantizeMove ? 'tak' : 'płynny'}
        </button>
      </div>
      <Slider
        id="lab-grid-turn"
        label="Wyrównanie skrętu"
        value={grid.turnCells}
        min={0}
        max={grid.divisions * 2}
        disabled={!grid.enabled}
        output={
          grid.turnCells === 0
            ? 'wyłączone'
            : `${grid.turnCells} kom. · ${px(grid.turnCells, grid)}`
        }
        onChange={(turnCells) => setGrid({ turnCells })}
      />
      <Slider
        id="lab-grid-dmg-w"
        label="Obszar dmg — szerokość"
        value={grid.damageWidth}
        min={1}
        max={grid.divisions * 2}
        disabled={!grid.enabled}
        output={`${grid.damageWidth} kom. · ${px(grid.damageWidth, grid)}`}
        onChange={(damageWidth) => setGrid({ damageWidth })}
      />
      <Slider
        id="lab-grid-dmg-d"
        label="Obszar dmg — głębokość"
        value={grid.damageDepth}
        min={0}
        max={grid.divisions}
        disabled={!grid.enabled}
        output={`${grid.damageDepth} kom. · ${px(grid.damageDepth, grid)}`}
        onChange={(damageDepth) => setGrid({ damageDepth })}
      />
      <ul className="lab-legend">
        {LEGEND.map(([color, text]) => (
          <li key={text}>
            <i style={{ background: color }} />
            {text}
          </li>
        ))}
      </ul>
      <p>
        Cegły w grze mają 4 px, więc obszar niszczenia zdejmuje każdą cegiełkę, której dotknie.
        Szerokość 8 komórek po 2 px = dokładnie szerokość czołgu.
      </p>
    </details>
  )
}

/**
 * Rysuje obrysy na planszy poligonu. Warstwy statyczne (siatka, ściany) odświeżają się tylko po
 * zmianie ustawień albo terenu — reszta co klatkę.
 */
export class LabOverlayPainter {
  private readonly gridLayer = new Graphics()
  private readonly wallLayer = new Graphics()
  private readonly live = new Graphics()
  private gridKey = ''
  private wallKey = ''

  constructor(parent: Container) {
    parent.addChild(this.wallLayer, this.gridLayer, this.live)
  }

  draw(sim: ControlLabSimulation, overlay: LabOverlay): void {
    const grid = sim.gridSettings
    const cell = cellSize(grid)
    const map = sim.scene.map

    const gridKey = `${overlay.grid}:${grid.divisions}`
    if (gridKey !== this.gridKey) {
      this.gridKey = gridKey
      const g = this.gridLayer.clear()
      if (overlay.grid) {
        if (grid.divisions > 1) {
          for (let x = cell; x < FIELD_WIDTH; x += cell) g.moveTo(x, 0).lineTo(x, FIELD_SIZE)
          for (let y = cell; y < FIELD_SIZE; y += cell) g.moveTo(0, y).lineTo(FIELD_WIDTH, y)
          g.stroke({ width: 1, pixelLine: true, color: 0xffffff, alpha: 0.22 })
        }
        for (let x = BLOCK_SIZE; x < FIELD_WIDTH; x += BLOCK_SIZE)
          g.moveTo(x, 0).lineTo(x, FIELD_SIZE)
        for (let y = BLOCK_SIZE; y < FIELD_SIZE; y += BLOCK_SIZE)
          g.moveTo(0, y).lineTo(FIELD_WIDTH, y)
        g.stroke({ width: 1, pixelLine: true, color: 0xff2a2a, alpha: 0.7 })
      }
    }

    const wallKey = `${overlay.walls}:${map.version}`
    if (wallKey !== this.wallKey) {
      this.wallKey = wallKey
      const g = this.wallLayer.clear()
      if (overlay.walls) {
        const b = ITEM_SIZE_MAP.BRICK
        map.forEachBrick((x, y) => g.rect(x, y, b, b))
        g.fill({ color: 0xff3b3b, alpha: 0.35 })
        const s = ITEM_SIZE_MAP.STEEL
        map.forEachSteel((x, y) => g.rect(x, y, s, s))
        g.fill({ color: 0x8fb4ff, alpha: 0.35 })
        const r = ITEM_SIZE_MAP.RIVER
        map.forEachRiver((x, y) => g.rect(x, y, r, r))
        g.fill({ color: 0x3ddcff, alpha: 0.3 })
      }
    }

    const g = this.live.clear()
    const tank = sim.tank
    if (overlay.collision) {
      g.rect(tank.rx, tank.ry, BLOCK_SIZE, BLOCK_SIZE).stroke({
        width: 0.6,
        color: 0xffd23d,
        alpha: 0.7,
      })
      g.rect(tank.x, tank.y, BLOCK_SIZE, BLOCK_SIZE).stroke({ width: 0.8, color: 0x3dff8a })
      for (const b of sim.scene.bullets) {
        const r = b.rect()
        g.rect(r.x, r.y, r.width, r.height).stroke({ width: 0.5, color: 0x3dff8a })
      }
    }
    if (overlay.turn) {
      const step = grid.enabled ? grid.turnCells * cell : 0
      if (step > 0) {
        // linie siatki skrętu wzdłuż osi jazdy — tu czołg stanie, skręcając w bok
        const { axis } = getDirectionInfo(tank.direction)
        const pos = tank[axis]
        const lines = [Math.floor(pos / step) * step, Math.ceil(pos / step) * step]
        for (const line of new Set(lines)) {
          if (axis === 'x') g.rect(line, tank.y - 4, BLOCK_SIZE, BLOCK_SIZE + 8)
          else g.rect(tank.x - 4, line, BLOCK_SIZE + 8, BLOCK_SIZE)
        }
        g.stroke({ width: 0.6, color: 0xff4dd8, alpha: 0.85 })
      }
    }
    if (overlay.damage) {
      for (const b of sim.scene.bullets) {
        const r = sim.damageOf(b)
        g.rect(r.x, r.y, r.width, r.height).stroke({ width: 0.6, color: 0xff8a2a })
      }
      for (const impact of sim.impacts) {
        const r = impact.rect
        g.rect(r.x, r.y, r.width, r.height).fill({ color: 0xff8a2a, alpha: 0.45 })
      }
    }
  }
}
