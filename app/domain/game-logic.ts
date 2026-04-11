import { createDeck, shuffleDeck, getCard } from "./cards";
import type { Card, Suit } from "./cards";
import {
  emptyBonuses,
  type GameState,
  type GameMode,
  type PublicGameState,
  type RoundBonuses,
  type RoundPlayerData,
  type TrickCard,
} from "./game-state";

// Re-export types needed by consumers
export type { GameState, GameMode, PublicGameState, RoundBonuses, TrickCard } from "./game-state";
import { scoreRound } from "./scoring";

export interface GameSettings {
  mode: GameMode;
  maxPlayers: number;
  seed: number;
}

// ─── Move types ─────────────────────────────────────────────────────────────

export type MoveType =
  | "join"
  | "start_game"
  | "bid"
  | "play_card"
  | "tigress_choice"
  | "scorekeeper_bid"
  | "scorekeeper_result";

export interface JoinData {
  type: "join";
  name: string;
}

export interface StartGameData {
  type: "start_game";
}

export interface BidData {
  type: "bid";
  amount: number;
}

export interface PlayCardData {
  type: "play_card";
  cardId: number;
  tigressChoice?: "escape" | "pirate";
}

// Scorekeeper mode: host submits bids for all players at once
export interface ScorekeeperBidData {
  type: "scorekeeper_bid";
  bids: number[]; // indexed by seat
}

// Scorekeeper mode: host submits round results
export interface ScorekeeperResultData {
  type: "scorekeeper_result";
  won: number[]; // tricks won, indexed by seat
  bonuses: RoundBonuses[]; // indexed by seat
}

export type MoveData =
  | JoinData
  | StartGameData
  | BidData
  | PlayCardData
  | ScorekeeperBidData
  | ScorekeeperResultData;

export interface MoveRecord {
  seat: number;
  sequence: number;
  moveType: MoveType;
  data: MoveData;
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initializeGame(settings: GameSettings): GameState {
  const { mode, maxPlayers, seed } = settings;
  return {
    mode,
    phase: "lobby",
    round: 0,
    trick: 0,
    dealer: 0,
    leadSeat: 1, // left of dealer leads first
    currentSeat: 1,
    trickCards: [],
    hands: Array.from({ length: maxPlayers }, () => []),
    roundData: Array.from({ length: maxPlayers }, () => ({
      bid: null,
      won: 0,
      bonuses: emptyBonuses(),
    })),
    cumulativeScores: Array(maxPlayers).fill(0),
    players: Array(maxPlayers).fill(null),
    maxPlayers,
    seed,
    status: "waiting",
    winner: null,
  };
}

// ─── Apply Move ───────────────────────────────────────────────────────────────

export function applyMove(state: GameState, move: MoveRecord): GameState {
  const s = deepClone(state);

  switch (move.data.type) {
    case "join":
      return applyJoin(s, move.seat, move.data.name);

    case "start_game":
      return applyStartGame(s);

    case "bid":
      return applyBid(s, move.seat, move.data.amount);

    case "play_card":
      return applyPlayCard(s, move.seat, move.data.cardId, move.data.tigressChoice);

    case "scorekeeper_bid":
      return applyScorekeeperBid(s, move.data.bids);

    case "scorekeeper_result":
      return applyScorekeeperResult(s, move.data.won, move.data.bonuses);
  }
}

// ─── Join ─────────────────────────────────────────────────────────────────────

function applyJoin(state: GameState, seat: number, name: string): GameState {
  if (seat < 0 || seat >= state.maxPlayers) return state;
  state.players[seat] = { seat, name, connected: true };
  return state;
}

// ─── Start Game / Deal ───────────────────────────────────────────────────────

function applyStartGame(state: GameState): GameState {
  state.round = 1;
  state.status = "active";
  return dealRound(state);
}

function dealRound(state: GameState): GameState {
  const { round, seed, maxPlayers, dealer } = state;
  const deck = shuffleDeck(createDeck(), seed, round);

  // Deal `round` cards to each player
  const hands: number[][] = Array.from({ length: maxPlayers }, () => []);
  let idx = 0;
  for (let card = 0; card < round; card++) {
    for (let seat = 0; seat < maxPlayers; seat++) {
      hands[seat].push(deck[idx++].id);
    }
  }

  state.hands = hands;
  state.phase = "bidding";
  state.trick = 1;
  state.trickCards = [];
  state.leadSeat = (dealer + 1) % maxPlayers;
  state.currentSeat = (dealer + 1) % maxPlayers;
  state.roundData = Array.from({ length: maxPlayers }, () => ({
    bid: null,
    won: 0,
    bonuses: emptyBonuses(),
  }));

  return state;
}

// ─── Bid ─────────────────────────────────────────────────────────────────────

function applyBid(state: GameState, seat: number, amount: number): GameState {
  if (state.phase !== "bidding") return state;
  state.roundData[seat].bid = amount;

  // Check if all players have bid
  const allBid = state.roundData.every((rd) => rd.bid !== null);
  if (allBid) {
    state.phase = "playing";
    state.currentSeat = state.leadSeat;
  }

  return state;
}

// ─── Play Card ───────────────────────────────────────────────────────────────

function applyPlayCard(
  state: GameState,
  seat: number,
  cardId: number,
  tigressChoice?: "escape" | "pirate",
): GameState {
  if (state.phase !== "playing") return state;
  if (state.currentSeat !== seat) return state;

  // Remove card from hand
  const hand = state.hands[seat];
  const cardIdx = hand.indexOf(cardId);
  if (cardIdx === -1) return state; // card not in hand
  state.hands[seat] = hand.filter((id) => id !== cardId);

  const trickCard: TrickCard = { seat, cardId, tigressChoice };
  state.trickCards.push(trickCard);

  // Advance to next player
  const nextSeat = nextActiveSeat(state, seat);
  const trickComplete = state.trickCards.length === state.maxPlayers;

  if (trickComplete) {
    state = resolveTrick(state);
  } else {
    state.currentSeat = nextSeat;
  }

  return state;
}

function nextActiveSeat(state: GameState, fromSeat: number): number {
  let seat = (fromSeat + 1) % state.maxPlayers;
  // In a full game all seats are active, but guard anyway
  while (!state.players[seat] && seat !== fromSeat) {
    seat = (seat + 1) % state.maxPlayers;
  }
  return seat;
}

// ─── Trick Resolution ────────────────────────────────────────────────────────

export interface TrickResult {
  winner: number; // seat
  bonuses: Map<number, Partial<RoundBonuses>>; // bonuses earned per seat
}

export function resolveTrick(state: GameState): GameState {
  const { trickCards, round, trick, maxPlayers } = state;
  const result = determineTrickWinner(trickCards);

  const winner = result.winner;
  state.roundData[winner].won++;

  // Apply bonuses to winner's round data
  for (const [seat, bonus] of result.bonuses) {
    const rd = state.roundData[seat];
    for (const [key, val] of Object.entries(bonus) as [keyof RoundBonuses, number][]) {
      rd.bonuses[key] += val;
    }
  }

  state.trickCards = [];

  const tricksInRound = round;
  if (trick >= tricksInRound) {
    // Round over — score it
    state = scoreRoundState(state);
  } else {
    state.trick = trick + 1;
    state.leadSeat = winner;
    state.currentSeat = winner;
    state.phase = "playing";
  }

  return state;
}

export function determineTrickWinner(trickCards: TrickCard[]): TrickResult {
  if (trickCards.length === 0) throw new Error("No cards in trick");

  const bonuses = new Map<number, Partial<RoundBonuses>>();

  // Determine lead suit from the first non-escape, non-special card played
  // If all escapes, lead suit is null
  let leadSuit: "parrots" | "maps" | "treasure_chests" | "jolly_rogers" | null = null;
  for (const tc of trickCards) {
    const card = getCard(tc.cardId);
    const effectiveType = tc.tigressChoice ?? card.type;
    if (effectiveType === "numbered" && card.suit) {
      leadSuit = card.suit;
      break;
    }
  }

  // Find winner by hierarchy
  // Priority (highest to lowest):
  // 1. Mermaid that captures Skull King (if both present)
  // 2. Skull King (captures pirates)
  // 3. Pirates (first pirate wins among multiple)
  // 4. Mermaids (beat numbered, but lose to pirates)
  // 5. Highest Jolly Rogers (if any played as numbered)
  // 6. Highest card of lead suit
  // 7. First Escape played (if all escapes)

  const hasSK = trickCards.some((tc) => getCard(tc.cardId).type === "skull_king");
  const pirates = trickCards.filter((tc) => {
    const card = getCard(tc.cardId);
    const eff = tc.tigressChoice ?? card.type;
    return eff === "pirate";
  });
  const mermaids = trickCards.filter((tc) => getCard(tc.cardId).type === "mermaid");

  // Mermaid beats Skull King
  if (hasSK && mermaids.length > 0) {
    const winner = mermaids[0].seat;
    bonuses.set(winner, { mermaidSkullKingCapture: 1 });
    return { winner, bonuses };
  }

  // Skull King beats pirates
  if (hasSK) {
    const skCard = trickCards.find((tc) => getCard(tc.cardId).type === "skull_king")!;
    const winner = skCard.seat;
    if (pirates.length > 0) {
      bonuses.set(winner, { skullKingPirateCapture: pirates.length });
    }
    return { winner, bonuses };
  }

  // Pirates beat everything else (first pirate wins)
  if (pirates.length > 0) {
    const firstPirate = pirates[0];
    const winner = firstPirate.seat;
    // Check if pirate captured mermaids
    if (mermaids.length > 0) {
      bonuses.set(winner, { pirateMermaidCapture: mermaids.length });
    }
    return { winner, bonuses };
  }

  // Mermaids beat numbered cards
  if (mermaids.length > 0) {
    return { winner: mermaids[0].seat, bonuses };
  }

  // All escapes — first escape wins
  const allEscapes = trickCards.every((tc) => {
    const card = getCard(tc.cardId);
    const eff = tc.tigressChoice ?? card.type;
    return eff === "escape";
  });
  if (allEscapes) {
    return { winner: trickCards[0].seat, bonuses };
  }

  // Numbered cards — Jolly Rogers (trump) beats other suits
  const jollyRogers = trickCards.filter((tc) => {
    const card = getCard(tc.cardId);
    return card.type === "numbered" && card.suit === "jolly_rogers";
  });

  let winner: number;
  if (jollyRogers.length > 0) {
    // Highest Jolly Rogers value wins
    const best = jollyRogers.reduce((a, b) =>
      (getCard(a.cardId).value ?? 0) >= (getCard(b.cardId).value ?? 0) ? a : b,
    );
    winner = best.seat;

    // Black 14 bonus (Jolly Rogers 14 captured by winner)
    const winnerCard = getCard(best.cardId);
    if (winnerCard.value === 14) {
      bonuses.set(winner, { blackFourteen: 1 });
    }
  } else if (leadSuit) {
    // Highest card of lead suit wins
    const leadCards = trickCards.filter((tc) => {
      const card = getCard(tc.cardId);
      return card.type === "numbered" && card.suit === leadSuit;
    });
    if (leadCards.length > 0) {
      const best = leadCards.reduce((a, b) =>
        (getCard(a.cardId).value ?? 0) >= (getCard(b.cardId).value ?? 0) ? a : b,
      );
      winner = best.seat;

      // Standard 14 bonus
      if (getCard(best.cardId).value === 14) {
        bonuses.set(winner, { standardFourteen: 1 });
      }
    } else {
      // No lead suit cards — first non-escape wins
      const nonEscape = trickCards.find((tc) => {
        const card = getCard(tc.cardId);
        const eff = tc.tigressChoice ?? card.type;
        return eff !== "escape";
      });
      winner = (nonEscape ?? trickCards[0]).seat;
    }
  } else {
    // No lead suit (all escapes/specials already handled above)
    winner = trickCards[0].seat;
  }

  return { winner, bonuses };
}

// ─── Score Round ─────────────────────────────────────────────────────────────

function scoreRoundState(state: GameState): GameState {
  for (let seat = 0; seat < state.maxPlayers; seat++) {
    const rd = state.roundData[seat];
    if (rd.bid === null) continue;
    const delta = scoreRound({
      bid: rd.bid,
      won: rd.won,
      roundNumber: state.round,
      bonuses: rd.bonuses,
    });
    state.cumulativeScores[seat] += delta;
  }

  state.phase = "scoring";

  if (state.round >= 10) {
    state.phase = "complete";
    state.status = "finished";
    state.winner = state.cumulativeScores.indexOf(Math.max(...state.cumulativeScores));
  }

  return state;
}

// ─── Start Next Round ────────────────────────────────────────────────────────

export function startNextRound(state: GameState): GameState {
  const s = deepClone(state);
  if (s.round >= 10) return s;
  s.round++;
  s.dealer = (s.dealer + 1) % s.maxPlayers;
  return dealRound(s);
}

// ─── Scorekeeper Mode ────────────────────────────────────────────────────────

function applyScorekeeperBid(state: GameState, bids: number[]): GameState {
  if (state.phase !== "bidding") return state;
  bids.forEach((bid, seat) => {
    if (seat < state.maxPlayers) state.roundData[seat].bid = bid;
  });
  state.phase = "playing";
  return state;
}

function applyScorekeeperResult(
  state: GameState,
  won: number[],
  bonuses: RoundBonuses[],
): GameState {
  if (state.phase !== "playing") return state;

  won.forEach((w, seat) => {
    if (seat < state.maxPlayers) state.roundData[seat].won = w;
  });
  bonuses.forEach((b, seat) => {
    if (seat < state.maxPlayers) state.roundData[seat].bonuses = b;
  });

  return scoreRoundState(state);
}

// ─── Start Scorekeeper Round ─────────────────────────────────────────────────

export function startScorekeeperRound(state: GameState): GameState {
  const s = deepClone(state);
  if (s.round === 0) {
    s.round = 1;
    s.status = "active";
  } else {
    if (s.round >= 10) return s;
    s.round++;
    s.dealer = (s.dealer + 1) % s.maxPlayers;
  }
  s.phase = "bidding";
  s.roundData = Array.from({ length: s.maxPlayers }, () => ({
    bid: null,
    won: 0,
    bonuses: emptyBonuses(),
  }));
  return s;
}

// ─── Serialize / Deserialize ─────────────────────────────────────────────────

export function serializeGameState(state: GameState): PublicGameState {
  return {
    ...state,
    hands: state.hands.map(() => []), // strip private hands
  };
}

export function deserializeGameState(data: PublicGameState): GameState {
  return {
    ...data,
    hands: Array.from({ length: data.maxPlayers }, () => []),
  };
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
