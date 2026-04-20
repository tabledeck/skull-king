import { describe, it, expect } from "vitest";
import { createDeck, shuffleDeck, getCard, CARD_MAP } from "../cards";

describe("createDeck", () => {
  it("produces exactly 70 cards", () => {
    expect(createDeck()).toHaveLength(70);
  });

  it("has 56 numbered cards (4 suits × 14 values)", () => {
    const deck = createDeck();
    const numbered = deck.filter((c) => c.type === "numbered");
    expect(numbered).toHaveLength(56);
  });

  it("has 4 cards of each suit valued 1–14", () => {
    const deck = createDeck();
    const suits = ["parrots", "maps", "treasure_chests", "jolly_rogers"] as const;
    for (const suit of suits) {
      const suitCards = deck.filter((c) => c.suit === suit);
      expect(suitCards).toHaveLength(14);
      const values = suitCards.map((c) => c.value).sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    }
  });

  it("has 5 escape cards with ids 56–60", () => {
    const deck = createDeck();
    const escapes = deck.filter((c) => c.type === "escape");
    expect(escapes).toHaveLength(5);
    const ids = escapes.map((c) => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([56, 57, 58, 59, 60]);
  });

  it("has 5 pirate cards with ids 61–65, each with a unique power", () => {
    const deck = createDeck();
    const pirates = deck.filter((c) => c.type === "pirate");
    expect(pirates).toHaveLength(5);
    const powers = pirates.map((c) => c.piratePower);
    const uniquePowers = new Set(powers);
    expect(uniquePowers.size).toBe(5);
  });

  it("has exactly one Tigress (id 66), one Skull King (id 67), and two Mermaids (ids 68–69)", () => {
    const deck = createDeck();
    expect(deck.filter((c) => c.type === "tigress")).toHaveLength(1);
    expect(deck.find((c) => c.type === "tigress")!.id).toBe(66);

    expect(deck.filter((c) => c.type === "skull_king")).toHaveLength(1);
    expect(deck.find((c) => c.type === "skull_king")!.id).toBe(67);

    expect(deck.filter((c) => c.type === "mermaid")).toHaveLength(2);
    const mermaidIds = deck.filter((c) => c.type === "mermaid").map((c) => c.id).sort();
    expect(mermaidIds).toEqual([68, 69]);
  });

  it("all card IDs are unique", () => {
    const deck = createDeck();
    const ids = deck.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("shuffleDeck", () => {
  it("returns the same number of cards", () => {
    const deck = createDeck();
    expect(shuffleDeck(deck, 42, 1)).toHaveLength(deck.length);
  });

  it("contains the same card IDs after shuffling (just reordered)", () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck, 42, 1);
    const originalIds = deck.map((c) => c.id).sort((a, b) => a - b);
    const shuffledIds = shuffled.map((c) => c.id).sort((a, b) => a - b);
    expect(shuffledIds).toEqual(originalIds);
  });

  it("is deterministic — same seed + round always yields the same order", () => {
    const deck = createDeck();
    const a = shuffleDeck(deck, 99, 3).map((c) => c.id);
    const b = shuffleDeck(deck, 99, 3).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it("produces different orders for different rounds (same seed)", () => {
    const deck = createDeck();
    const round1 = shuffleDeck(deck, 42, 1).map((c) => c.id);
    const round2 = shuffleDeck(deck, 42, 2).map((c) => c.id);
    expect(round1).not.toEqual(round2);
  });

  it("produces different orders for different seeds (same round)", () => {
    const deck = createDeck();
    const seedA = shuffleDeck(deck, 1, 5).map((c) => c.id);
    const seedB = shuffleDeck(deck, 2, 5).map((c) => c.id);
    expect(seedA).not.toEqual(seedB);
  });
});

describe("getCard", () => {
  it("retrieves a numbered card by id with correct properties", () => {
    // id 0 = parrots 1 (first card created)
    const card = getCard(0);
    expect(card.type).toBe("numbered");
    expect(card.suit).toBe("parrots");
    expect(card.value).toBe(1);
  });

  it("retrieves the Skull King by id 67", () => {
    const card = getCard(67);
    expect(card.type).toBe("skull_king");
    expect(card.name).toBe("Skull King");
  });

  it("retrieves Tigress by id 66", () => {
    const card = getCard(66);
    expect(card.type).toBe("tigress");
  });

  it("retrieves Mermaid by id 68", () => {
    const card = getCard(68);
    expect(card.type).toBe("mermaid");
  });

  it("retrieves a jolly_rogers 14 card correctly (id 55)", () => {
    // jolly_rogers is the 4th suit (index 3), value 14 → id = 3*14 + 13 = 55
    const card = getCard(55);
    expect(card.type).toBe("numbered");
    expect(card.suit).toBe("jolly_rogers");
    expect(card.value).toBe(14);
  });

  it("throws for an unknown card id", () => {
    expect(() => getCard(999)).toThrow("Unknown card id: 999");
  });

  it("CARD_MAP has an entry for every id in the deck", () => {
    const deck = createDeck();
    for (const card of deck) {
      expect(CARD_MAP.has(card.id)).toBe(true);
    }
    expect(CARD_MAP.size).toBe(70);
  });
});
