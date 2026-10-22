import type { PowerUpName, TankLevel } from './types'

/**
 * Zdarzenia rozgrywki wysyłane przez silnik na zewnątrz (osiągnięcia, doświadczenie, statystyki).
 * Silnik tylko je ogłasza — nic w nim od nich nie zależy, więc odbiorca nie zmienia przebiegu gry
 * (testy-nagrania zostają deterministyczne). `time` to czas sceny w ms (od startu planszy).
 *
 * `playerId` to identyfikator gracza z PlayerConfig (w trybie party — telefon/profil).
 */
export type GameEvent =
  | { type: 'stage_started'; stageName: string; stageNumber: number; playerIds: string[] }
  | {
      type: 'stage_cleared'
      stageName: string
      stageNumber: number
      /** ile trwała plansza (ms czasu sceny) */
      duration: number
      players: { playerId: string; score: number; kills: Record<TankLevel, number> }[]
    }
  | { type: 'game_over'; stageName: string; stageNumber: number; reason: 'eagle' | 'dead' }
  /** przeszli wszystkie plansze */
  | { type: 'game_cleared'; stageName: string; scores: { playerId: string; score: number }[] }
  | { type: 'player_spawned'; time: number; playerId: string; level: TankLevel }
  | { type: 'shot'; time: number; playerId: string }
  /** trafienie wroga; killed=false dla opancerzonego, który jeszcze żyje */
  | { type: 'bot_hit'; time: number; playerId: string; level: TankLevel; killed: boolean }
  /**
   * wróg zniszczony; playerId null, gdy strzelec już nie żyje (punkty przepadają);
   * by: 'grenade' — wszystkie wrogie czołgi naraz bonusem granatu
   */
  | {
      type: 'bot_killed'
      time: number
      playerId: string | null
      level: TankLevel
      score: number
      by: 'bullet' | 'grenade'
    }
  | { type: 'player_died'; time: number; playerId: string; killerLevel: TankLevel | null }
  /** gracz trafił gracza (zamrożenie) */
  | { type: 'teammate_hit'; time: number; playerId: string; targetId: string }
  | { type: 'powerup_picked'; time: number; playerId: string; name: PowerUpName }
  | {
      type: 'life_gained'
      time: number
      playerId: string
      reason: 'score' | 'powerup' | 'borrowed'
    }
  | { type: 'eagle_destroyed'; time: number }

export interface EventPort {
  emit(event: GameEvent): void
}

/** domyślny odbiorca: zdarzenia nigdzie nie trafiają */
export const NO_EVENTS: EventPort = { emit: () => {} }
