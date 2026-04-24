import { describe, it, expect } from "vitest";
import { applyMove, initializeGame } from "../game-logic";
import type { GameState, MoveRecord } from "../game-logic";

// Minimal helper to craft a GameState in the "playing" phase with a
// deterministic hand so we can test play-card rules directly.
function makePlayingState(overrides: Partial<GameState> = {}): GameState {
  const base = initializeGame({ mode: "digital", maxPlayers: 3, seed: 1 });
  return {
    ...base,
    phase: "playing",
    round: 2,
    trick: 1,
    dealer: 0,
    leadSeat: 1,
    currentSeat: 1,
    trickCards: [],
    hands: [
      [0, 1],   // seat 0
      [2, 3],   // seat 1
      [4, 5],   // seat 2
    ],
    players: [
      { seat: 0, name: "A", connected: true },
      { seat: 1, name: "B", connected: true },
      { seat: 2, name: "C", connected: true },
    ],
    ...overrides,
  };
}

function playMove(seat: number, cardId: number): MoveRecord {
  return {
    seat,
    sequence: 0,
    moveType: "play_card",
    data: { type: "play_card", cardId },
  };
}

describe("applyMove(play_card) — one card per trick", () => {
  it("advances currentSeat after a legal play", () => {
    const state = makePlayingState();
    const next = applyMove(state, playMove(1, 2));
    expect(next.trickCards).toHaveLength(1);
    expect(next.trickCards[0]).toMatchObject({ seat: 1, cardId: 2 });
    expect(next.currentSeat).toBe(2);
    expect(next.hands[1]).toEqual([3]);
  });

  it("rejects a play from a seat that is not currentSeat", () => {
    const state = makePlayingState({ currentSeat: 1 });
    const next = applyMove(state, playMove(0, 0));
    // State should be unchanged — the move is a no-op
    expect(next.currentSeat).toBe(1);
    expect(next.trickCards).toHaveLength(0);
    expect(next.hands[0]).toEqual([0, 1]);
  });

  it("rejects a second play from the same seat in the same trick", () => {
    // Simulate a race: seat 1 has already played into the trick, and
    // somehow currentSeat is still 1 (e.g., state was rewound mid-race).
    // The authoritative check must refuse this.
    const state = makePlayingState({
      currentSeat: 1,
      trickCards: [{ seat: 1, cardId: 2 }],
      hands: [
        [0, 1],
        [3],
        [4, 5],
      ],
    });
    const next = applyMove(state, playMove(1, 3));
    expect(next.trickCards).toHaveLength(1);
    expect(next.trickCards[0]!.cardId).toBe(2);
    expect(next.hands[1]).toEqual([3]);
  });
});
