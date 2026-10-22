import raw from '../../config/rozgrywka.json'

const integer = (value: unknown, min: number, max: number, key: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new Error(`config/rozgrywka.json: ${key} musi być liczbą całkowitą ${min}–${max}`)
  return value
}

export function parseGameplayConfig(value: typeof raw) {
  const xpMaxLevel = integer(value.xp.maxLevel, 1, 10, 'xp.maxLevel')
  return {
    playerStartRank: integer(value.playerStartRank, 1, 5, 'playerStartRank'),
    playerSpawnShieldMs: integer(value.playerSpawnShieldMs, 0, 60000, 'playerSpawnShieldMs'),
    enemySpawnShieldMs: integer(value.enemySpawnShieldMs, 0, 60000, 'enemySpawnShieldMs'),
    bonusShieldMs: integer(value.bonusShieldMs, 0, 60000, 'bonusShieldMs'),
    xpMaxLevel,
    xpKillRewards: {
      basic: integer(value.xp.killRewards?.basic, 0, 1000000, 'xp.killRewards.basic'),
      fast: integer(value.xp.killRewards?.fast, 0, 1000000, 'xp.killRewards.fast'),
      power: integer(value.xp.killRewards?.power, 0, 1000000, 'xp.killRewards.power'),
      armor: integer(value.xp.killRewards?.armor, 0, 1000000, 'xp.killRewards.armor'),
    },
    xpStartLevels: {
      speed: integer(value.xp.startLevels.speed, 0, xpMaxLevel, 'xp.startLevels.speed'),
      fire: integer(value.xp.startLevels.fire, 0, xpMaxLevel, 'xp.startLevels.fire'),
      armor: integer(value.xp.startLevels.armor, 0, xpMaxLevel, 'xp.startLevels.armor'),
      // nowsze cechy: brak w starym pliku = 0
      bullet: integer(value.xp.startLevels.bullet ?? 0, 0, xpMaxLevel, 'xp.startLevels.bullet'),
      shield: integer(value.xp.startLevels.shield ?? 0, 0, xpMaxLevel, 'xp.startLevels.shield'),
    },
  }
}

/** Ten sam plik jest wbudowany w klienta, poligon i serwer — także w paczkę aktualizacji. */
export const GAMEPLAY = parseGameplayConfig(raw)
export const CONFIGURED_XP = raw.xp
