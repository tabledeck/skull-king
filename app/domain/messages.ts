import { z } from "zod";

// ─── Client → Server ─────────────────────────────────────────────────────────

export const JoinGameMsg = z.object({
  type: z.literal("join_game"),
  name: z.string().min(1).max(20),
});

export const BidMsg = z.object({
  type: z.literal("bid"),
  amount: z.number().int().min(0).max(10),
});

export const PlayCardMsg = z.object({
  type: z.literal("play_card"),
  cardId: z.number().int().min(0).max(69),
  tigressChoice: z.enum(["escape", "pirate"]).optional(),
});

export const StartGameMsg = z.object({
  type: z.literal("start_game"),
});

export const NextRoundMsg = z.object({
  type: z.literal("next_round"),
});

// Scorekeeper mode
export const ScorekeeperBidMsg = z.object({
  type: z.literal("scorekeeper_bid"),
  bids: z.array(z.number().int().min(0).max(10)),
});

export const ScorekeeperResultMsg = z.object({
  type: z.literal("scorekeeper_result"),
  won: z.array(z.number().int().min(0).max(10)),
  bonuses: z.array(
    z.object({
      standardFourteen: z.number().int().min(0).default(0),
      blackFourteen: z.number().int().min(0).default(0),
      loot: z.number().int().min(0).default(0),
      pirateMermaidCapture: z.number().int().min(0).default(0),
      skullKingPirateCapture: z.number().int().min(0).default(0),
      mermaidSkullKingCapture: z.number().int().min(0).default(0),
    }),
  ),
});

export const ChatMsg = z.object({
  type: z.literal("chat"),
  presetId: z.number().int().min(0),
});

export const PingMsg = z.object({
  type: z.literal("ping"),
});

export const ClientMessage = z.discriminatedUnion("type", [
  JoinGameMsg,
  BidMsg,
  PlayCardMsg,
  StartGameMsg,
  NextRoundMsg,
  ScorekeeperBidMsg,
  ScorekeeperResultMsg,
  ChatMsg,
  PingMsg,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

// ─── Server → Client ─────────────────────────────────────────────────────────

// Typed loosely — the client will receive and narrow these
export type ServerMessage =
  | { type: "game_state"; state: unknown; yourHand: number[] }
  | { type: "hand_dealt"; hand: number[]; round: number }
  | { type: "bid_reveal"; bids: (number | null)[]; allBids: number[] }
  | { type: "card_played"; seat: number; cardId: number; tigressChoice?: "escape" | "pirate" }
  | { type: "trick_result"; winner: number; bonuses: Record<string, unknown>; trickCards: unknown[] }
  | { type: "round_score"; scores: number[]; deltas: number[]; roundData: unknown[] }
  | { type: "next_round_ready"; round: number }
  | { type: "game_over"; finalScores: number[]; winner: number }
  | { type: "player_joined"; seat: number; name: string }
  | { type: "player_disconnected"; seat: number }
  | { type: "chat_broadcast"; seat: number; presetId: number; playerName: string }
  | { type: "error"; message: string }
  | { type: "pong" };

// ─── Chat Presets ─────────────────────────────────────────────────────────────

export const CHAT_PRESETS = [
  "Yo ho ho!",
  "Nice trick!",
  "Walk the plank!",
  "I'm going for it!",
  "No mercy!",
  "Argh!",
  "Well played!",
  "You'll regret that!",
  "The Skull King reigns!",
  "Shiver me timbers!",
] as const;
