import type { RoundBonuses } from "./game-state";

export interface RoundScoreInput {
  bid: number;
  won: number;
  roundNumber: number;
  bonuses: RoundBonuses;
}

// Adapted from the original appUtils.ts getRoundScore logic (preserved exactly).
export function scoreRound({ bid, won, roundNumber, bonuses }: RoundScoreInput): number {
  let scoreDelta = 0;
  const deltaTricks = won - bid;

  if (bid === 0 && won === 0) {
    // Bid 0 and won 0: bonus = round * 10
    scoreDelta += roundNumber * 10;
  } else if (bid > 0 && deltaTricks === 0) {
    // Exact bid: +20 per trick
    scoreDelta += bid * 20;
  } else {
    if (bid === 0) {
      // Bid 0 but won tricks: penalty
      scoreDelta += roundNumber * -10;
    } else {
      // Missed bid: -10 per trick off
      scoreDelta += Math.abs(deltaTricks) * -10;
    }
  }

  // Bonus points (only apply when player won the trick)
  scoreDelta += bonuses.blackFourteen * 20;
  scoreDelta += bonuses.standardFourteen * 10;
  scoreDelta += bonuses.loot * 20;
  scoreDelta += bonuses.pirateMermaidCapture * 20;
  scoreDelta += bonuses.skullKingPirateCapture * 30;
  scoreDelta += bonuses.mermaidSkullKingCapture * 40;

  return scoreDelta;
}
