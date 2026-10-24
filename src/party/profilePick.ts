import type { PartyRoomState } from './protocol'

/**
 * Wybór profilu gracza w lobby (telefon, klawiatura i pady przy TV): lista „Gość” + wolne
 * profile — tych zajętych przez inne pady nie da się wybrać.
 */
export function nextProfileId(room: PartyRoomState, slot: number, delta: number): string | null {
  const mine = room.padPlayers?.[slot] ?? null
  const taken = new Set(room.padPlayers?.filter((p, i) => i !== slot && p != null) as string[])
  const options: (string | null)[] = [
    null,
    ...(room.players ?? []).map((p) => p.id).filter((id) => !taken.has(id)),
  ]
  const i = Math.max(0, options.indexOf(mine))
  return options[(i + delta + options.length) % options.length]
}

/** zapamiętany profil (telefon: jeden klucz, pady przy TV: osobny na każdy) */
export function savedProfile(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function rememberProfile(key: string, id: string | null): void {
  try {
    if (id == null) localStorage.removeItem(key)
    else localStorage.setItem(key, id)
  } catch {
    // prywatne okno
  }
}

/** czy zapamiętany profil jest wolny dla tego slotu */
export function canTakeProfile(room: PartyRoomState, slot: number, id: string): boolean {
  return (
    (room.players?.some((p) => p.id === id) ?? false) &&
    !(room.padPlayers?.some((p, i) => i !== slot && p === id) ?? false)
  )
}
