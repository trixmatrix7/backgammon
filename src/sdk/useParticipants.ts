import { useEffect, useRef, useState } from "react";
import type { LobbySnapshot, PvpHostApiV2 } from "@pvp-sdk";
import type { Seat } from "../ui/names";

/**
 * The lobby's seats, in entry order.
 *
 * V2 stopped putting the roster on the lobby snapshot: a lobby reports
 * `participantCount`, and the addresses come from `getLobbyParticipants`, which is
 * paged and asynchronous. That is the right shape for a jackpot with hundreds of
 * entrants and an awkward one for a game with two seats, so this hook hides it — it
 * fetches once per lobby, refetches when the count changes, and hands back a plain
 * array the UI can index by seat.
 *
 * Entry order is authoritative: it is the same order the ledger's `participantIndex`
 * returns on chain, which is what the contract uses to decide who is seat 0.
 */
export function useParticipants(
  hostApi: PvpHostApiV2 | null,
  lobby: LobbySnapshot | null,
): Seat[] {
  const [seats, setSeats] = useState<Seat[]>([]);
  const key = lobby ? `${lobby.lobbyId}:${lobby.participantCount}` : "";
  const loaded = useRef("");

  useEffect(() => {
    if (!hostApi || !lobby || key === loaded.current) return;
    let cancelled = false;
    loaded.current = key;

    void (async () => {
      const out: Seat[] = [];
      let cursor: string | undefined;
      // Two seats fit in one page, but the loop is here because the API is paged and a
      // silent truncation would show a match with one player in it.
      do {
        const page = await hostApi.getLobbyParticipants({ lobbyId: lobby.lobbyId, cursor });
        out.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && out.length < 64);
      if (!cancelled) setSeats(out);
    })().catch(() => {
      // A failed fetch must not strand the UI on a stale roster; allow a retry.
      loaded.current = "";
    });

    return () => {
      cancelled = true;
    };
  }, [hostApi, lobby, key]);

  return seats;
}
