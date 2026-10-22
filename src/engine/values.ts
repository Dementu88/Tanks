import type Tank from './entities/Tank'
import { playerStats, rankOfLevel } from './tankStats'

/** statystyki gracza z tabeli LV1–LV5 (config/czolgi.json); czołgi bez poziomu — po typie */
const statsOf = (tank: Tank) => playerStats(tank.rank > 0 ? tank.rank : rankOfLevel(tank.level))

/**
 * 坦克数值规格（移速、弹速、弹间隔、弹数、威力）。
 * bot 移速取 NES 原版数值。
 */

/** 移动速度（px/ms） */
export function moveSpeed(tank: Tank): number {
  if (tank.side === 'player') {
    return statsOf(tank).moveSpeed * tank.xpSpeedMultiplier
  }
  return tank.level === 'fast' ? 0.06 : 0.03
}

/** 子弹速度（px/ms） */
export function bulletSpeed(tank: Tank): number {
  if (tank.side === 'player') {
    return statsOf(tank).bulletSpeed * tank.xpBulletSpeedMultiplier
  }
  if (tank.level === 'basic') {
    return 0.12
  } else if (tank.level === 'power') {
    return 0.24
  } else {
    return 0.18
  }
}

/** 子弹威力：玩家 armor 为 3（可破钢），bot power 为 2，其余为 1 */
export function bulletPower(tank: Tank): number {
  if (tank.side === 'player') {
    return statsOf(tank).bulletPower
  } else if (tank.level === 'power') {
    return 2
  } else {
    return 1
  }
}

/** 开火间隔（ms） */
export function bulletInterval(tank: Tank): number {
  if (tank.side === 'player') {
    return statsOf(tank).fireInterval / tank.xpFireRateMultiplier
  }
  return tank.level === 'basic' ? 300 : 200
}

/** 同时在场的最大子弹数：玩家 power/armor 为 2，其余为 1 */
export function bulletLimit(tank: Tank): number {
  if (tank.side === 'player') {
    return statsOf(tank).bulletLimit
  }
  return 1
}
