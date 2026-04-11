import type { Card, Suit } from "./cards";

// Game mode: "digital" = full online card game, "scorekeeper" = physical cards + digital scoring
export type GameMode = "digital" | "scorekeeper";

// State machine phases
export type GamePhase =
  | "lobby"      // waiting for players to join
  | "bidding"    // players submitting bids (simultaneous)
  | "playing"    // trick-taking phase
  | "scoring"    // round just ended, showing scores
  | "complete";  // all 10 rounds done, game over

export interface PlayerInfo {
  seat: number;
  name: string;
  userId?: string;
  connected: boolean;
}

export interface TrickCard {
  seat: number;
  cardId: number;
  tigressChoice?: "escape" | "pirate"; // only if cardId === 66 (Tigress)
}

export interface RoundBonuses {
  standardFourteen: number;  // +10 each
  blackFourteen: number;     // +20 each (Jolly Rogers 14)
  loot: number;              // +20 each (not used in standard rules, kept for compat)
  pirateMermaidCapture: number;   // +20 each: Pirate wins trick with Mermaid
  skullKingPirateCapture: number; // +30 each: Skull King wins trick with Pirate(s)
  mermaidSkullKingCapture: number; // +40 each: Mermaid wins trick containing Skull King
}

export function emptyBonuses(): RoundBonuses {
  return {
    standardFourteen: 0,
    blackFourteen: 0,
    loot: 0,
    pirateMermaidCapture: 0,
    skullKingPirateCapture: 0,
    mermaidSkullKingCapture: 0,
  };
}

// Per-round player data
export interface RoundPlayerData {
  bid: number | null;   // null = not yet bid
  won: number;          // tricks won so far this round
  bonuses: RoundBonuses;
}

export interface GameState {
  mode: GameMode;
  phase: GamePhase;
  round: number;         // 1-10
  trick: number;         // 1-N within round
  dealer: number;        // seat index, rotates each round
  leadSeat: number;      // who leads the current trick
  currentSeat: number;   // whose turn to play (playing phase)
  trickCards: TrickCard[]; // cards played so far in current trick
  hands: number[][];     // card IDs indexed by seat (private)
  roundData: RoundPlayerData[]; // indexed by seat
  cumulativeScores: number[];   // indexed by seat
  players: (PlayerInfo | null)[];
  maxPlayers: number;
  seed: number;
  status: "waiting" | "active" | "finished";
  winner: number | null; // seat index of winner
}

// Public state (strip private hands, only send to each player their own hand)
export type PublicGameState = Omit<GameState, "hands"> & {
  hands: null[][];
};
