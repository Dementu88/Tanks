import { BLOCK_SIZE } from '../constants'
import type { Rect } from '../physics/geometry'
import type { PowerUpName } from '../types'

let nextPowerUpId = 1

/** 场上道具（可变）。显示 16×16，但碰撞框为居中的 8×8。 */
export default class PowerUp {
  readonly id: number
  readonly name: PowerUpName
  x: number
  y: number
  visible = true
  /** 闪烁计时（每 8 帧切换可见性） */
  blinkTimer = 0
  dead = false
  /**
   * ukryta w cegłach: rysowana pod cegłami w połowie rozmiaru, nie miga i nie znika,
   * gdy pojawia się nowy bonus — trzeba ją wystrzelać z muru
   */
  hidden = false
  /** ile ms leży na planszy (minimalny czas życia: SessionOptions.powerUpMinMs) */
  age = 0

  constructor(name: PowerUpName, x: number, y: number) {
    this.id = nextPowerUpId++
    this.name = name
    this.x = x
    this.y = y
  }

  /** 拾取碰撞框：居中 8×8 */
  rect(): Rect {
    return { x: this.x + BLOCK_SIZE / 4, y: this.y + BLOCK_SIZE / 4, width: 8, height: 8 }
  }
}

export function resetPowerUpIds(): void {
  nextPowerUpId = 1
}
