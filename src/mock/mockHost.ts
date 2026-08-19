// Local stand-in for the Chain host + PvpGameFacet, for Chain Gammon. Simulates a PvP lobby system
// WITHOUT a chain: browse open tables, open one (a challenger trickles in), join by code, pick the
// match length + per-turn clock, then play YOU (seat 0) vs a bot at seat 1. Swap for the real penpal
// host when embedded in chain.wtf — see sdk/useHost.ts.
//
// It is deliberately written as an imitation of the CONTRACT, not as a game loop: it validates through
// the same @engine reducer, hands every ROLL/NEXT a fresh randomness word exactly where the facet
// would, and emits the same abi-encoded bytes. That makes it the working spec for GammonGame.sol.
import type { Hex } from "viem";
import type { PvpHostApiV1, PvpHostSnapshotV1, LobbySnapshot, LobbyPhaseName } from "@pvp-sdk";
import {
  PHASE_CUBE,
  PHASE_GAME_OVER,
  PHASE_MOVE,
  PHASE_ROLL,
  autoTurn,
  type Action,
} from "@engine";
import manifest from "../../public/game.manifest.json";
import { encodeState, encodeConfig, decodeConfig, decodeAction, toEngineAction } from "../game/codec";
import { eventDuration, RESULT_MS, WIN_REVEAL_MS } from "../game/pacing";
import { startMatch, step, botFor, type MockMatch } from "../game/runtime";

const pad = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as `0x${string}`;
const YOU = pad(0x11);
const BOT = pad(0x22); // fills the second seat at match start
const FAKE = [pad(4), pad(5), pad(6), pad(7), pad(8), pad(9)]; // other "players" in the table browser
const GAME = pad(0x6a11); // game contract address (mock)
const DECIMALS = 6;
const FEE_BPS = 500; // 5%
const HUMAN = 0;

// Simulated host-supplied profiles. The client reads LobbyPlayer.metadata verbatim; without it, it
// would fall back to a name hashed from the address (there is no username input anywhere in the game).
const NAME: Record<string, string> = {
  [YOU]: "You",
  [BOT]: "Kavanagh",
  [FAKE[0]]: "Blitz",
  [FAKE[1]]: "Anchor",
  [FAKE[2]]: "Prime Time",
  [FAKE[3]]: "Backgammon Bella",
  [FAKE[4]]: "The Cube",
  [FAKE[5]]: "Bear Off",
};

// Pacing.
const THINK_MS = 480; // a beat of "the opponent is deciding" before each bot action
const SETUP_MS = 1600; // hold before the first turn so the intro plays
const FILL_MS = 1800; // the challenger sits down this long after you open a table
const AUTOSTART_MS = 1500; // after you join someone's table, the host starts it

const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randCode = () => Array.from({ length: 4 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join("");
const HEX = "0123456789abcdef";
const randSeed = () =>
  ("0x" + Array.from({ length: 64 }, () => HEX[Math.floor(Math.random() * 16)]).join("")) as `0x${string}`;

interface LobbyRec {
  id: string; // doubles as the shareable join code
  creator: `0x${string}`;
  buyIn: string;
  maxPlayers: number; // always 2
  turnSec: number;
  matchTo: number;
  cubeOn: boolean;
  officialOpening: boolean;
  players: `0x${string}`[];
  phase: LobbyPhaseName;
}

export class MockHost {
  private push: (s: PvpHostSnapshotV1) => void;
  private onNotice?: (msg: string) => void;
  private lobbies: LobbyRec[] = [];
  private match: MockMatch | null = null;
  private activeId: string | null = null;
  private myLobbyId: string | null = null;
  private matchTimer: ReturnType<typeof setTimeout> | null = null;
  private lobbyTimer: ReturnType<typeof setTimeout> | null = null;
  private loopToken = 0;
  private turnOwner = -1; // seat whose deadline is currently running
  private balance = 1_000_000_000n; // 1,000 USDC
  private paidOut = false;

  constructor(push: (s: PvpHostSnapshotV1) => void, onNotice?: (msg: string) => void) {
    this.push = push;
    this.onNotice = onNotice;
    this.ensureSeeds();
    queueMicrotask(() => this.emit());
  }

  // ── table list ──────────────────────────────────────────────────────────────

  private ensureSeeds() {
    const openOthers = this.lobbies.filter((l) => l.creator !== YOU && l.phase === "WAITING_FOR_PLAYERS");
    // [buyIn, turnSec, matchTo, hostAddr]
    const seeds: Array<[string, number, number, `0x${string}`]> = [
      ["10000000", 45, 5, FAKE[0]],
      ["25000000", 60, 7, FAKE[3]],
      ["5000000", 30, 3, FAKE[2]],
    ];
    for (let i = openOthers.length; i < seeds.length; i++) {
      const [buyIn, turnSec, matchTo, host] = seeds[i];
      this.lobbies.push({
        id: randCode(),
        creator: host,
        buyIn,
        maxPlayers: 2,
        turnSec,
        matchTo,
        cubeOn: matchTo > 1,
        officialOpening: false,
        players: [host],
        phase: "WAITING_FOR_PLAYERS",
      });
    }
  }

  private find(id: string) {
    const up = id.trim().toUpperCase();
    return this.lobbies.find((l) => l.id === up);
  }
  private myLobby() {
    return this.lobbies.find((l) => l.id === this.myLobbyId);
  }

  api(): PvpHostApiV1 {
    return {
      createLobby: async ({ buyIn, config }) => {
        const cfg = decodeConfig(config);
        const rec: LobbyRec = {
          id: randCode(),
          creator: YOU,
          buyIn,
          maxPlayers: 2,
          turnSec: cfg.turnSec,
          matchTo: cfg.matchTo,
          cubeOn: cfg.cubeOn,
          officialOpening: cfg.officialOpening,
          players: [YOU],
          phase: "WAITING_FOR_PLAYERS",
        };
        this.lobbies.unshift(rec);
        this.myLobbyId = rec.id;
        this.scheduleFill();
        this.emit();
        return { lobbyId: rec.id, transactionHash: "0xmock" as Hex };
      },
      joinLobby: async ({ lobbyId }) => {
        const rec = this.find(lobbyId);
        if (rec && rec.phase === "WAITING_FOR_PLAYERS" && !rec.players.includes(YOU) && rec.players.length < 2) {
          rec.players.push(YOU);
          this.myLobbyId = rec.id;
          if (rec.creator !== YOU) {
            this.lobbyTimer = setTimeout(() => this.start(rec.id), AUTOSTART_MS);
          }
          this.emit();
        }
        return { transactionHash: "0xmock" as Hex };
      },
      leaveLobby: async ({ lobbyId }) => {
        this.leave(lobbyId);
        return { transactionHash: "0xmock" as Hex };
      },
      startLobby: async ({ lobbyId }) => {
        this.start(lobbyId);
        return { transactionHash: "0xmock" as Hex };
      },
      submitAction: async ({ actionData }) => {
        this.onHumanAction(actionData);
        return { transactionHash: "0xmock" as Hex };
      },
      cancelLobby: async ({ lobbyId }) => {
        this.leave(lobbyId);
        return { transactionHash: "0xmock" as Hex };
      },
    };
  }

  private scheduleFill() {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.lobbyTimer = setTimeout(() => {
      const rec = this.myLobby();
      if (!rec || rec.creator !== YOU || rec.phase !== "WAITING_FOR_PLAYERS") return;
      if (rec.players.length < 2) {
        rec.players.push(FAKE[Math.floor(Math.random() * FAKE.length)]);
        this.emit();
      }
      this.lobbyTimer = setTimeout(() => this.start(rec.id), 900);
    }, FILL_MS);
  }

  private start(id: string) {
    const rec = this.find(id);
    if (!rec || this.activeId || rec.phase !== "WAITING_FOR_PLAYERS") return;
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    // Seat YOU at 0; keep whoever sat down as the rival (the bot AI drives that seat), else a bot.
    const opponent = rec.players.find((a) => a !== YOU) ?? BOT;
    rec.players = [YOU, opponent];
    rec.phase = "WAITING_PLAYER_ACTION";
    this.match = startMatch(rec.matchTo, rec.turnSec * 1000, randSeed(), rec.cubeOn, rec.officialOpening);
    this.activeId = id;
    this.myLobbyId = id;
    this.turnOwner = -1;
    const stake = BigInt(rec.buyIn);
    this.balance = this.balance > stake ? this.balance - stake : 0n;
    this.paidOut = false;
    this.emit();
    this.matchTimer = setTimeout(() => {
      if (this.match) this.match.deadline = Date.now() + this.match.turnMs;
      this.loop();
    }, SETUP_MS);
  }

  private leave(_id?: string) {
    if (this.matchTimer) clearTimeout(this.matchTimer);
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.loopToken++;
    const rec = this.myLobby();
    if (rec) {
      if (rec.creator === YOU || this.activeId === rec.id) {
        this.lobbies = this.lobbies.filter((l) => l.id !== rec.id);
      } else {
        rec.players = rec.players.filter((a) => a !== YOU);
      }
    }
    this.match = null;
    this.activeId = null;
    this.myLobbyId = null;
    this.ensureSeeds();
    this.emit();
  }

  // ── match flow ────────────────────────────────────────────────────────────────

  private activeRec() {
    return this.lobbies.find((l) => l.id === this.activeId);
  }
  private setPhase(p: LobbyPhaseName) {
    const r = this.activeRec();
    if (r) r.phase = p;
  }
  private getPhase(): LobbyPhaseName {
    return this.activeRec()?.phase ?? "NONE";
  }

  /** How long the client will spend animating whatever just happened. */
  private lastEventMs(): number {
    const e = this.match?.es.lastEvent;
    if (!e) return 260;
    return eventDuration(e.kind, e.moves);
  }

  private onHumanAction(actionData: Hex) {
    const m = this.match;
    if (!m || m.winner !== null) return;
    if (this.getPhase() !== "WAITING_PLAYER_ACTION") return;
    const { kind, moves } = decodeAction(actionData);
    const action = toEngineAction(kind, moves);
    // NEXT may come from either seat; everything else has to be the human's own turn.
    if (action.type !== "next" && m.es.current !== HUMAN) return;
    const before = m.es.seq;
    if (this.matchTimer) clearTimeout(this.matchTimer);
    step(m, action.type === "next" ? m.es.current : HUMAN, action, randSeed());
    if (m.es.seq === before) {
      // The engine refused it (a stale or illegal submission). On-chain this is a revert; here we just
      // resume the clock so the player is never locked out of their own turn.
      this.loop();
      return;
    }
    this.loop();
  }

  /** The action the host plays for a player who let their clock run out. Always legal, always
   *  deterministic — the same rule a contract would apply. */
  private timeoutAction(): Action {
    const es = this.match!.es;
    switch (es.phase) {
      case PHASE_MOVE:
        return { type: "move", moves: autoTurn(es) };
      case PHASE_CUBE:
        return { type: "pass" };
      case PHASE_GAME_OVER:
        return { type: "next" };
      case PHASE_ROLL:
      default:
        return { type: "roll" };
    }
  }

  private humanTimeout() {
    const m = this.match;
    if (!m || m.winner !== null || m.es.current !== HUMAN) return;
    const action = this.timeoutAction();
    step(m, HUMAN, action, randSeed());
    this.onNotice?.(
      action.type === "pass"
        ? "Time's up — the double was declined for you."
        : "Time's up — your turn was played for you.",
    );
    this.loop();
  }

  /** Drive the match: wait on the human (soft per-turn clock), or play one bot action per tick. */
  private loop() {
    const token = ++this.loopToken;
    const m = this.match;
    if (!m) return;
    if (m.winner !== null) {
      this.revealWin(token);
      return;
    }

    const es = m.es;
    const anim = this.lastEventMs();

    // Between games: let the scoreline land, then deal the next board. Either seat may submit NEXT, so
    // the host just does it once the beat is over (the player can also press it early).
    if (es.phase === PHASE_GAME_OVER) {
      this.turnOwner = -1;
      m.deadline = Date.now() + anim + RESULT_MS;
      this.emit();
      this.matchTimer = setTimeout(() => {
        if (token !== this.loopToken || !this.match) return;
        step(m, m.es.current, { type: "next" }, randSeed());
        this.loop();
      }, anim + RESULT_MS);
      return;
    }

    const cur = es.current;
    const newTurn = cur !== this.turnOwner;
    this.turnOwner = cur;

    if (cur === HUMAN) {
      // The clock covers the whole turn (cube decision, roll and move), not each step of it.
      if (newTurn || es.phase === PHASE_CUBE) m.deadline = Date.now() + m.turnMs;
      this.emit();
      const ms = Math.max(900, m.deadline - Date.now());
      this.matchTimer = setTimeout(() => {
        if (token !== this.loopToken) return;
        this.humanTimeout();
      }, ms);
      return;
    }

    // Bot turn — one action per tick, never faster than the animation the client is still playing.
    const wait = anim + THINK_MS;
    m.deadline = Date.now() + wait;
    this.emit();
    this.matchTimer = setTimeout(() => {
      if (token !== this.loopToken || !this.match) return;
      step(m, m.es.current, botFor(m), randSeed());
      this.loop();
    }, wait);
  }

  private revealWin(token: number) {
    if (this.matchTimer) clearTimeout(this.matchTimer);
    this.emit(); // the final board on screen, winner set, still in the match view
    this.matchTimer = setTimeout(() => {
      if (token !== this.loopToken) return;
      this.resolveWin();
    }, this.lastEventMs() + WIN_REVEAL_MS);
  }

  private resolveWin() {
    if (!this.paidOut) {
      this.paidOut = true;
      const rec = this.activeRec();
      if (rec && this.match && this.match.winner !== null) {
        const pot = BigInt(rec.buyIn) * 2n;
        const dist = pot - (pot * BigInt(FEE_BPS)) / 10000n;
        if (this.match.winner === HUMAN) this.balance += dist;
        else if (this.match.winner === -1) this.balance += dist / 2n; // drawn match → split
      }
    }
    this.setPhase("RESOLVED");
    this.emit();
  }

  // ── snapshot ────────────────────────────────────────────────────────────────

  private emit() {
    this.push(this.snapshot());
  }

  private lobbyToSnapshot(rec: LobbyRec): LobbySnapshot {
    const isActive = rec.id === this.activeId && !!this.match;
    const pot = BigInt(rec.buyIn) * 2n;
    let payout: LobbySnapshot["payout"];
    if (rec.phase === "RESOLVED" && this.match && this.match.winner !== null) {
      const w = this.match.winner;
      const fee = (pot * BigInt(FEE_BPS)) / 10000n;
      const dist = pot - fee;
      if (w === -1) {
        const half = dist / 2n;
        payout = {
          players: rec.players,
          shareBps: [5000, 5000],
          amounts: [half.toString(), (dist - half).toString()],
          feeAmount: fee.toString(),
        };
      } else {
        payout = {
          players: rec.players,
          shareBps: rec.players.map((_, i) => (i === w ? 10000 : 0)),
          amounts: rec.players.map((_, i) => (i === w ? dist.toString() : "0")),
          feeAmount: fee.toString(),
        };
      }
    }
    return {
      lobbyId: rec.id,
      gameAddress: GAME,
      creator: rec.creator,
      phaseName: rec.phase,
      buyIn: rec.buyIn,
      pot: pot.toString(),
      protocolFeeBps: FEE_BPS,
      maxPlayers: 2,
      players: rec.players.map((address) => ({
        address,
        isYou: address === YOU,
        metadata: { username: NAME[address], displayName: NAME[address] },
      })),
      isResolved: rec.phase === "RESOLVED",
      lastEventTimestamp: Date.now(),
      payout,
      raw: {
        config: encodeConfig(rec.turnSec, rec.matchTo, rec.cubeOn, rec.officialOpening),
        gameState: isActive ? encodeState(this.match!.es, Math.floor(this.match!.deadline / 1000)) : undefined,
      },
    };
  }

  private snapshot(): PvpHostSnapshotV1 {
    return {
      apiVersion: 1,
      integration: { chainId: 8453, slug: "gammon", gameAddress: GAME, manifest: manifest as never },
      wallet: { address: YOU, smartVaultAddress: YOU, status: "ready" },
      token: { symbol: "USDC", decimals: DECIMALS },
      balances: { smartVaultBalance: this.balance.toString() },
      protocol: { feeBps: FEE_BPS },
      metadata: { viewer: { displayName: "You" } },
      lobbies: { items: this.lobbies.map((l) => this.lobbyToSnapshot(l)) },
      ui: { locale: "en", theme: "dark" },
    };
  }
}
