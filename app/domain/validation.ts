import { getCard } from "./cards";
import type { TrickCard } from "./game-state";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateBid(bid: number, roundNumber: number): ValidationResult {
  if (!Number.isInteger(bid) || bid < 0 || bid > roundNumber) {
    return { valid: false, reason: `Bid must be between 0 and ${roundNumber}` };
  }
  return { valid: true };
}

export function validatePlayCard(
  cardId: number,
  hand: number[],
  trickCards: TrickCard[],
  tigressChoice?: "escape" | "pirate",
): ValidationResult {
  // Card must be in hand
  if (!hand.includes(cardId)) {
    return { valid: false, reason: "Card not in hand" };
  }

  const card = getCard(cardId);

  // Tigress needs a choice
  if (card.type === "tigress" && !tigressChoice) {
    return { valid: false, reason: "Must choose Escape or Pirate for Tigress" };
  }

  // Special cards (pirates, skull king, mermaids, escapes, tigress) can always be played
  const effectiveType = tigressChoice ?? card.type;
  if (effectiveType !== "numbered") {
    return { valid: true };
  }

  // For numbered cards, check suit-following rule
  if (trickCards.length === 0) {
    // Leading — anything goes
    return { valid: true };
  }

  // Determine lead suit from first non-escape card played
  let leadSuit: string | null = null;
  for (const tc of trickCards) {
    const tc_card = getCard(tc.cardId);
    const eff = tc.tigressChoice ?? tc_card.type;
    if (eff === "numbered" && tc_card.suit) {
      leadSuit = tc_card.suit;
      break;
    }
    // If lead was a special card, no suit requirement
    if (eff !== "escape") {
      return { valid: true };
    }
  }

  if (!leadSuit) {
    // Lead was all escapes, no suit requirement
    return { valid: true };
  }

  // Must follow lead suit if able
  if (card.suit !== leadSuit) {
    const hasLeadSuit = hand.some((id) => {
      const c = getCard(id);
      return c.type === "numbered" && c.suit === leadSuit;
    });
    if (hasLeadSuit) {
      return { valid: false, reason: `Must follow ${leadSuit} suit` };
    }
  }

  return { valid: true };
}
