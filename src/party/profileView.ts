import { WIDE_STAGE, type PartyRoomState } from './protocol'

type Mode = 'classic' | 'random' | 'wide'

/** tryb planszy wybrany w lobby — rekord profilu liczy się osobno dla każdego */
export function roomMode(room: PartyRoomState): Mode {
  return room.stageIndex === WIDE_STAGE ? 'wide' : room.stageIndex < 0 ? 'random' : 'classic'
}

/** najdalsza plansza profilu w obecnym trybie, od 1 */
export function recordStage(room: PartyRoomState): number {
  return (room.profile?.record[roomMode(room)] ?? 0) + 1
}

/** losowe plansze mają wybór: od rekordu albo od początku */
export function hasRecordStart(room: PartyRoomState): boolean {
  return roomMode(room) !== 'classic'
}
