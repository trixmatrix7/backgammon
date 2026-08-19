import type { LobbyPlayer, PvpHostSnapshotV1 } from "@pvp-sdk";

/** Seat colours. 1v1: seat 0 = ice blue, seat 1 = ember red — the two checker sets, and the accent
 *  every panel, banner and glow for that player is tinted with. */
export const SEAT_HEX = ["#4aa8ff", "#ff5a4e", "#3ad07a", "#ffce3a"];

export function seatColor(i: number): string {
  return SEAT_HEX[i % SEAT_HEX.length];
}

// Deterministic fallback names for dev, when no host metadata is attached (backgammon roster).
const POOL = [
  "Blitz", "Anchor", "Prime Time", "Bear Off", "The Cube", "Backgammon Bella", "Kavanagh", "Blot",
  "Doubler", "Pip", "Ace Point", "Golden Anchor", "Boxcar", "Midpoint", "Beaver", "Jacoby",
];

export function hashName(addr: string): string {
  let h = 0;
  for (const ch of addr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return POOL[h % POOL.length];
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * The display name for a seat. The host owns identity — there is no "enter your name" field anywhere
 * in this game — so we take its metadata verbatim and only invent something when it sends none.
 */
export function playerName(p: LobbyPlayer): string {
  const given = p.metadata?.displayName?.trim() || p.metadata?.username?.trim();
  if (given) return given;
  return import.meta.env.DEV ? hashName(p.address) : shortAddress(p.address);
}

/** The viewer's own name, which the host may supply separately from the seat metadata. */
export function viewerName(snapshot: PvpHostSnapshotV1, self?: LobbyPlayer): string {
  return snapshot.metadata?.viewer?.displayName?.trim() || (self ? playerName(self) : "You");
}
