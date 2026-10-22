import type GameSession from '../engine/GameSession'
import type { BattleView } from './BattleOverlay'

/** 不依赖 React / PixiJS，服务端跑引擎时（party 模式）也要用 */
export const INITIAL_VIEW: BattleView = {
  hudVisible: false,
  remainingBots: 0,
  lives: [],
  autopilot: [],
  canBorrowLife: [],
  curtain: 0,
  stageName: '',
  gameoverProgress: null,
}

export function toView(session: GameSession): BattleView {
  const scene = session.scene
  return {
    hudVisible: session.hudVisible,
    remainingBots: scene?.remainingBotCount ?? 0,
    lives: scene?.lives ?? [],
    autopilot: session.players.map((p) => p.pilot === 'autopilot'),
    canBorrowLife: scene?.canBorrowLife ?? [],
    curtain: session.curtain,
    stageName: session.stage.name,
    gameoverProgress: session.phase === 'gameover' ? session.gameoverProgress : null,
  }
}
