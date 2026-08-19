import { useEffect, useState } from "react";
import type { PvpHostApiV1, PvpHostSnapshotV1, PvpGuestApiV1 } from "@pvp-sdk";

/** Dev-only controls, exposed by the local debug console. `undefined` in production builds. */
export interface DebugControls {
  active: boolean;
  startMock: () => void; // spin up the local contract-imitating host (adds an opponent)
  stopMock: () => void; // hand control back to the real host
}

/**
 * Production: the app is the PVP guest. The real chain.wtf host pushes snapshots over penpal, and
 * ALL authority lives on-chain / in the host — randomness, move validation, escrow, the protocol fee
 * and payouts. This client only renders snapshots and submits the player's action.
 *
 * Standalone / dev: when there is NO real host (the app is the top window — local dev or the Vercel
 * URL opened directly), a demo can load `MockHost`, which merely *imitates* what the smart contract
 * would return (same rules, same encoded bytes). It is dynamically imported and only offered when
 * `window.parent === window`; embedded inside chain.wtf the real host always wins and the demo never
 * appears, so the on-chain path is never affected.
 */
export function useHost() {
  const [snapshot, setSnapshot] = useState<PvpHostSnapshotV1 | null>(null);
  const [hostApi, setHostApi] = useState<PvpHostApiV1 | null>(null);
  const [mockActive, setMockActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null); // transient toast

  // Real host connection (skipped only while a dev mock has deliberately taken over).
  useEffect(() => {
    if (mockActive) return;
    let alive = true;
    let cleanup = () => {};
    const guest: PvpGuestApiV1 = {
      async setState(s) {
        if (alive) setSnapshot(s);
      },
    };
    import("@pvp-sdk/guest").then(({ connectGameToHost, observeGameContentSize }) => {
      if (!alive) return;
      const conn = connectGameToHost(guest);
      let sizer: { disconnect(): void } | null = null;
      conn.promise.then((parent) => {
        if (!alive) return;
        setHostApi(parent as PvpHostApiV1);
        // Dynamic iframe sizing (SDK 2026.07.03): the host sizes the frame from the height we report.
        sizer = observeGameContentSize(parent as PvpHostApiV1);
      });
      cleanup = () => {
        sizer?.disconnect();
        conn.destroy();
      };
    });
    return () => {
      alive = false;
      cleanup();
    };
  }, [mockActive]);

  // The demo is offered ONLY when there is no real host to break: in local dev, or when the app is the
  // TOP window (opened standalone — not embedded in chain.wtf). Inside the chain.wtf iframe
  // `window.parent !== window`, so this is false and the on-chain integration is untouched.
  const standalone = typeof window !== "undefined" && window.parent === window && window.top === window;
  // `VITE_DEMO_BOT=0` removes the bot from the bundle entirely (see `startMock`).
  const botBuilt = import.meta.env.VITE_DEMO_BOT !== "0";

  // In a deployed build the demo has to be ASKED for: `?demo=1`. The deployment exists so
  // the game can be tested end to end, but the mock host imitates the contract closely
  // enough — real-looking dice, a score, a pot that settles — that somebody arriving at
  // the bare URL could take a fake match for a real one. Requiring the flag means nobody
  // reaches it by accident, and `DemoBanner` makes sure nobody who does reach it is in
  // any doubt. Local dev needs no flag.
  const demoAsked =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
  const demoAllowed = botBuilt && (import.meta.env.DEV || (standalone && demoAsked));
  const debug: DebugControls | undefined = demoAllowed
    ? {
        active: mockActive,
        startMock: async () => {
          // Guard placed BEFORE the dynamic import, not around the object that holds it:
          // Vite substitutes the env value literally, so this collapses to `if (true)
          // return` and rollup can then prove the import unreachable and drop the whole
          // chunk. Gating further out left the import statically reachable and the bot
          // still shipped, just unused.
          if (import.meta.env.VITE_DEMO_BOT === "0") return;
          const { MockHost } = await import("../mock/mockHost");
          let clearTimer: ReturnType<typeof setTimeout> | undefined;
          const mock = new MockHost(setSnapshot, (msg) => {
            setNotice(msg);
            if (clearTimer) clearTimeout(clearTimer);
            clearTimer = setTimeout(() => setNotice(null), 3800);
          });
          setHostApi(mock.api());
          setMockActive(true);
        },
        stopMock: () => {
          setMockActive(false);
          setSnapshot(null);
          setHostApi(null);
          setNotice(null);
        },
      }
    : undefined;

  return { snapshot, hostApi, debug, notice };
}
