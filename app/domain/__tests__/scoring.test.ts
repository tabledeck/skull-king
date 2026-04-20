import { describe, it, expect } from "vitest";
import { scoreRound } from "../scoring";
import { emptyBonuses } from "../game-state";

// Helper to build a RoundBonuses object with overrides
function bonuses(overrides: Partial<ReturnType<typeof emptyBonuses>> = {}) {
  return { ...emptyBonuses(), ...overrides };
}

describe("scoreRound — zero bid", () => {
  it("bid 0, won 0 → +roundNumber × 10", () => {
    expect(scoreRound({ bid: 0, won: 0, roundNumber: 3, bonuses: bonuses() })).toBe(30);
    expect(scoreRound({ bid: 0, won: 0, roundNumber: 10, bonuses: bonuses() })).toBe(100);
  });

  it("bid 0 but won tricks → penalty of -roundNumber × 10", () => {
    expect(scoreRound({ bid: 0, won: 2, roundNumber: 4, bonuses: bonuses() })).toBe(-40);
    expect(scoreRound({ bid: 0, won: 1, roundNumber: 7, bonuses: bonuses() })).toBe(-70);
  });
});

describe("scoreRound — exact bid", () => {
  it("bid 1, won 1 → +20", () => {
    expect(scoreRound({ bid: 1, won: 1, roundNumber: 5, bonuses: bonuses() })).toBe(20);
  });

  it("bid 3, won 3 → +60", () => {
    expect(scoreRound({ bid: 3, won: 3, roundNumber: 5, bonuses: bonuses() })).toBe(60);
  });

  it("bid 5, won 5 → +100", () => {
    expect(scoreRound({ bid: 5, won: 5, roundNumber: 5, bonuses: bonuses() })).toBe(100);
  });
});

describe("scoreRound — missed bid", () => {
  it("bid 3, won 1 → -20 (2 tricks off × 10)", () => {
    expect(scoreRound({ bid: 3, won: 1, roundNumber: 5, bonuses: bonuses() })).toBe(-20);
  });

  it("bid 2, won 5 → -30 (3 tricks over × 10)", () => {
    expect(scoreRound({ bid: 2, won: 5, roundNumber: 5, bonuses: bonuses() })).toBe(-30);
  });

  it("bid 1, won 0 → -10", () => {
    expect(scoreRound({ bid: 1, won: 0, roundNumber: 5, bonuses: bonuses() })).toBe(-10);
  });
});

describe("scoreRound — bonus scoring", () => {
  it("Skull King capturing 2 pirates adds +60 (2 × 30) on top of base score", () => {
    const result = scoreRound({
      bid: 1,
      won: 1,
      roundNumber: 5,
      bonuses: bonuses({ skullKingPirateCapture: 2 }),
    });
    // 20 (exact bid) + 60 (2 pirate captures) = 80
    expect(result).toBe(80);
  });

  it("Mermaid capturing Skull King adds +40", () => {
    const result = scoreRound({
      bid: 1,
      won: 1,
      roundNumber: 5,
      bonuses: bonuses({ mermaidSkullKingCapture: 1 }),
    });
    // 20 + 40 = 60
    expect(result).toBe(60);
  });

  it("Pirate capturing a Mermaid adds +20", () => {
    const result = scoreRound({
      bid: 2,
      won: 2,
      roundNumber: 5,
      bonuses: bonuses({ pirateMermaidCapture: 1 }),
    });
    // 40 + 20 = 60
    expect(result).toBe(60);
  });

  it("black 14 (Jolly Rogers 14) adds +20", () => {
    const result = scoreRound({
      bid: 1,
      won: 1,
      roundNumber: 5,
      bonuses: bonuses({ blackFourteen: 1 }),
    });
    // 20 + 20 = 40
    expect(result).toBe(40);
  });

  it("standard 14 adds +10", () => {
    const result = scoreRound({
      bid: 1,
      won: 1,
      roundNumber: 5,
      bonuses: bonuses({ standardFourteen: 1 }),
    });
    // 20 + 10 = 30
    expect(result).toBe(30);
  });

  it("bonuses still apply even when bid is missed (they are separate from bid points)", () => {
    // A player misses their bid but earned bonuses — bonuses are added regardless
    const result = scoreRound({
      bid: 3,
      won: 1,
      roundNumber: 5,
      bonuses: bonuses({ skullKingPirateCapture: 1 }),
    });
    // -20 (miss) + 30 (SK capture) = 10
    expect(result).toBe(10);
  });

  it("bonuses still apply on a zero-bid bust (penalty + bonus)", () => {
    const result = scoreRound({
      bid: 0,
      won: 1,
      roundNumber: 4,
      bonuses: bonuses({ blackFourteen: 1 }),
    });
    // -40 (bid-0 bust) + 20 (black 14) = -20
    expect(result).toBe(-20);
  });

  it("multiple bonus types stack correctly", () => {
    const result = scoreRound({
      bid: 2,
      won: 2,
      roundNumber: 6,
      bonuses: bonuses({
        skullKingPirateCapture: 1,
        mermaidSkullKingCapture: 0,
        blackFourteen: 1,
        standardFourteen: 2,
      }),
    });
    // 40 (bid) + 30 (SK capture) + 20 (black14) + 20 (2×std14) = 110
    expect(result).toBe(110);
  });
});
