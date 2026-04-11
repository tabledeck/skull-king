// Skull King 70-card deck definitions

export type Suit = "parrots" | "maps" | "treasure_chests" | "jolly_rogers";

export type CardType =
  | "numbered"
  | "escape"
  | "pirate"
  | "tigress"
  | "skull_king"
  | "mermaid";

export type PiratePower =
  | "draw_2"       // Draw 2 extra cards next round
  | "peek"         // Peek at another player's hand
  | "change_trump" // Change the lead suit of this trick
  | "steal"        // Steal 10 points from another player
  | "double_loot"; // Double your loot bonus this round

export interface Card {
  id: number;
  type: CardType;
  suit?: Suit;
  value?: number; // 1-14 for numbered cards
  piratePower?: PiratePower;
  name?: string; // display name for special cards
}

// Card IDs: 0-55 = numbered, 56-60 = escapes, 61-65 = pirates, 66 = tigress, 67 = skull king, 68-69 = mermaids

function makeNumbered(): Card[] {
  const suits: Suit[] = ["parrots", "maps", "treasure_chests", "jolly_rogers"];
  const cards: Card[] = [];
  let id = 0;
  for (const suit of suits) {
    for (let value = 1; value <= 14; value++) {
      cards.push({ id: id++, type: "numbered", suit, value });
    }
  }
  return cards; // 56 cards, ids 0-55
}

const PIRATE_POWERS: PiratePower[] = [
  "draw_2",
  "peek",
  "change_trump",
  "steal",
  "double_loot",
];

const PIRATE_NAMES = [
  "Rascal of Roatan",
  "Juanita Jade",
  "Harry the Giant",
  "Blaggard Betty",
  "The Kraken",
];

export function createDeck(): Card[] {
  const cards: Card[] = [...makeNumbered()];

  // 5 Escape cards (ids 56-60)
  for (let i = 0; i < 5; i++) {
    cards.push({ id: 56 + i, type: "escape", name: "Escape" });
  }

  // 5 Pirates (ids 61-65), each with a unique power
  for (let i = 0; i < 5; i++) {
    cards.push({
      id: 61 + i,
      type: "pirate",
      piratePower: PIRATE_POWERS[i],
      name: PIRATE_NAMES[i],
    });
  }

  // Tigress (id 66) - wildcard
  cards.push({ id: 66, type: "tigress", name: "Tigress" });

  // Skull King (id 67)
  cards.push({ id: 67, type: "skull_king", name: "Skull King" });

  // 2 Mermaids (ids 68-69)
  cards.push({ id: 68, type: "mermaid", name: "Mermaid" });
  cards.push({ id: 69, type: "mermaid", name: "Mermaid" });

  return cards; // 70 cards total
}

// Seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleDeck(deck: Card[], seed: number, round: number): Card[] {
  const arr = [...deck];
  const rand = mulberry32(seed ^ (round * 1000003));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Lookup map for fast card retrieval
const FULL_DECK = createDeck();
export const CARD_MAP = new Map<number, Card>(FULL_DECK.map((c) => [c.id, c]));

export function getCard(id: number): Card {
  const card = CARD_MAP.get(id);
  if (!card) throw new Error(`Unknown card id: ${id}`);
  return card;
}
