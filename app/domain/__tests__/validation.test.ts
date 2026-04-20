import { describe, it, expect } from "vitest";
import { validateBid, validatePlayCard } from "../validation";
import type { TrickCard } from "../game-state";

// Card ID constants (from cards.ts layout)
// Numbered: id = suitIndex * 14 + (value - 1)
// parrots=0, maps=1, treasure_chests=2, jolly_rogers=3
const PARROTS_1 = 0;   // parrots, value 1
const PARROTS_7 = 6;   // parrots, value 7
const MAPS_1 = 14;     // maps, value 1
const MAPS_5 = 18;     // maps, value 5
const JOLLY_ROGERS_14 = 55; // jolly_rogers, value 14

const ESCAPE_1 = 56;
const ESCAPE_2 = 57;
const PIRATE_1 = 61;   // Rascal of Roatan
const TIGRESS = 66;
const SKULL_KING = 67;
const MERMAID_1 = 68;

// Helper for an empty trick
const NO_TRICK: TrickCard[] = [];

// Helper to make a plain numbered trick card
function tc(seat: number, cardId: number, tigressChoice?: "escape" | "pirate"): TrickCard {
  return { seat, cardId, tigressChoice };
}

// ─── validateBid ─────────────────────────────────────────────────────────────

describe("validateBid", () => {
  it("allows bid of 0", () => {
    expect(validateBid(0, 5).valid).toBe(true);
  });

  it("allows bid equal to round number", () => {
    expect(validateBid(5, 5).valid).toBe(true);
  });

  it("allows any bid between 0 and roundNumber", () => {
    for (let b = 0; b <= 7; b++) {
      expect(validateBid(b, 7).valid).toBe(true);
    }
  });

  it("rejects bid exceeding round number", () => {
    const result = validateBid(6, 5);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/5/);
  });

  it("rejects negative bid", () => {
    expect(validateBid(-1, 5).valid).toBe(false);
  });

  it("rejects non-integer bid", () => {
    expect(validateBid(1.5, 5).valid).toBe(false);
  });
});

// ─── validatePlayCard — card in hand ─────────────────────────────────────────

describe("validatePlayCard — card ownership", () => {
  it("rejects a card not in the player's hand", () => {
    const result = validatePlayCard(PIRATE_1, [PARROTS_1, MAPS_1], NO_TRICK);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not in hand/i);
  });

  it("accepts a card that is in the player's hand", () => {
    const result = validatePlayCard(PARROTS_1, [PARROTS_1, MAPS_1], NO_TRICK);
    expect(result.valid).toBe(true);
  });
});

// ─── validatePlayCard — Tigress ───────────────────────────────────────────────

describe("validatePlayCard — Tigress", () => {
  it("rejects Tigress played without a tigressChoice", () => {
    const result = validatePlayCard(TIGRESS, [TIGRESS], NO_TRICK);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/tigress/i);
  });

  it("accepts Tigress played as escape", () => {
    expect(validatePlayCard(TIGRESS, [TIGRESS], NO_TRICK, "escape").valid).toBe(true);
  });

  it("accepts Tigress played as pirate", () => {
    expect(validatePlayCard(TIGRESS, [TIGRESS], NO_TRICK, "pirate").valid).toBe(true);
  });
});

// ─── validatePlayCard — leading a trick ──────────────────────────────────────

describe("validatePlayCard — leading the trick", () => {
  it("any card can lead a trick (numbered)", () => {
    expect(validatePlayCard(PARROTS_7, [PARROTS_7], NO_TRICK).valid).toBe(true);
  });

  it("special cards can always lead", () => {
    expect(validatePlayCard(SKULL_KING, [SKULL_KING], NO_TRICK).valid).toBe(true);
    expect(validatePlayCard(MERMAID_1, [MERMAID_1], NO_TRICK).valid).toBe(true);
    expect(validatePlayCard(PIRATE_1, [PIRATE_1], NO_TRICK).valid).toBe(true);
    expect(validatePlayCard(ESCAPE_1, [ESCAPE_1], NO_TRICK).valid).toBe(true);
  });
});

// ─── validatePlayCard — suit following ───────────────────────────────────────

describe("validatePlayCard — suit following", () => {
  it("must follow lead suit when able", () => {
    // Lead was parrots, player has parrots but tries to play maps
    const trick: TrickCard[] = [tc(0, PARROTS_1)];
    const hand = [MAPS_5, PARROTS_7]; // has parrots, must follow
    const result = validatePlayCard(MAPS_5, hand, trick);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/parrots/i);
  });

  it("can play off-suit if player has no cards of the lead suit", () => {
    const trick: TrickCard[] = [tc(0, PARROTS_1)];
    const hand = [MAPS_5]; // no parrots
    expect(validatePlayCard(MAPS_5, hand, trick).valid).toBe(true);
  });

  it("can always play an escape regardless of lead suit", () => {
    const trick: TrickCard[] = [tc(0, PARROTS_1)];
    const hand = [ESCAPE_1, PARROTS_7]; // has parrots, but escape is special
    expect(validatePlayCard(ESCAPE_1, hand, trick).valid).toBe(true);
  });

  it("can always play a pirate regardless of lead suit", () => {
    const trick: TrickCard[] = [tc(0, PARROTS_1)];
    const hand = [PIRATE_1, PARROTS_7];
    expect(validatePlayCard(PIRATE_1, hand, trick).valid).toBe(true);
  });

  it("can always play Skull King regardless of lead suit", () => {
    const trick: TrickCard[] = [tc(0, PARROTS_1)];
    const hand = [SKULL_KING, PARROTS_7];
    expect(validatePlayCard(SKULL_KING, hand, trick).valid).toBe(true);
  });

  it("no suit requirement when the lead card was a special (pirate)", () => {
    // Pirate was led — no suit established
    const trick: TrickCard[] = [tc(0, PIRATE_1)];
    const hand = [MAPS_5, PARROTS_7];
    expect(validatePlayCard(MAPS_5, hand, trick).valid).toBe(true);
  });

  it("no suit requirement when lead was an escape (suit remains unset)", () => {
    // Single escape led — lead suit is still null
    const trick: TrickCard[] = [tc(0, ESCAPE_1)];
    const hand = [MAPS_5, PARROTS_7];
    expect(validatePlayCard(MAPS_5, hand, trick).valid).toBe(true);
  });

  it("suit is established by first non-escape card even if escape was played first", () => {
    // Seat 0 plays escape, seat 1 plays parrots — suit is now parrots
    const trick: TrickCard[] = [tc(0, ESCAPE_1), tc(1, PARROTS_1)];
    const hand = [MAPS_5, PARROTS_7];
    // Player has parrots — must follow
    const result = validatePlayCard(MAPS_5, hand, trick);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/parrots/i);
  });
});
