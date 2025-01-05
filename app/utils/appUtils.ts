import { Round, score } from "@prisma/client";

export const intToRound = (number: number): Round => {
  switch (number) {
    case 1:
      return Round.ONE;
    case 2:
      return Round.TWO;
    case 3:
      return Round.THREE;
    case 4:
      return Round.FOUR;
    case 5:
      return Round.FIVE;
    case 6:
      return Round.SIX;
    case 7:
      return Round.SEVEN;
    case 8:
      return Round.EIGHT;
    case 9:
      return Round.NINE;
    case 10:
      return Round.TEN;
    default:
      return Round.ONE;
  }
};

export const roundToInt = (round: Round): number => {
  switch (round) {
    case Round.ONE:
      return 1;
    case Round.TWO:
      return 2;
    case Round.THREE:
      return 3;
    case Round.FOUR:
      return 4;
    case Round.FIVE:
      return 5;
    case Round.SIX:
      return 6;
    case Round.SEVEN:
      return 7;
    case Round.EIGHT:
      return 8;
    case Round.NINE:
      return 9;
    case Round.TEN:
      return 10;
  }
};

export const getRoundScore = (score: score, roundNumber: number): number => {
  let scoreDelta = 0;
  let deltaTricks = (score.won ?? 0) - (score.bid ?? 0);
  if (score.bid === 0 && score.won === 0) {
    scoreDelta += roundNumber * 10;
  } else if ((score.bid ?? 0) > 0 && deltaTricks === 0) {
    scoreDelta += (score.bid ?? 0) * 20;
  } else {
    if ((score.bid ?? 0) === 0) {
     scoreDelta += roundNumber * -10
    } else {
    scoreDelta += Math.abs(deltaTricks) * -10;
    }
  }
  if (score.blackFourteen) {
    scoreDelta += score.blackFourteen * 20;
  }
  if (score.standardFourteen) {
    scoreDelta += score.standardFourteen * 10;
  }
  if (score.loot) {
    scoreDelta += score.loot * 20;
  }
  if (score.pirateMermaidCapture) {
    scoreDelta += score.pirateMermaidCapture * 20;
  }
  if (score.skullKingPirateCapture) {
    scoreDelta += score.skullKingPirateCapture * 30;
  }
  if (score.mermaidSkullKingCapture) {
    scoreDelta += score.mermaidSkullKingCapture * 40;
  }
  return scoreDelta;
};
