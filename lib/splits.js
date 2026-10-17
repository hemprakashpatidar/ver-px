import { HttpError } from './errors.js';
import { toPaise } from './money.js';

// Splits a total (integer paise) among participants. Every result adds up to the total
// exactly. Returns [{ personId, paise, weight }] in the participants' order.
//
//   equal:   everyone the same; leftover paise go to the first participants (payer first)
//   exact:   rupee amounts per person; must add up to the total
//   percent: percentages (up to 2 decimals) that add up to 100
//   shares:  any positive weights, e.g. 2 : 1 : 1

// Whole parts from integer weights, with leftover paise going to the largest
// fractional remainders (ties: earlier participant first)
const allocate = (totalPaise, weights) => {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const raw = weights.map(w => (totalPaise * w) / weightSum);
  const floors = raw.map(Math.floor);
  let leftover = totalPaise - floors.reduce((sum, p) => sum + p, 0);
  const byRemainder = raw
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (leftover === 0) break;
    floors[index] += 1;
    leftover -= 1;
  }
  return floors;
};

// Two-decimal values as integers (12.5 -> 1250) so sums are exact
const hundredths = (value) => Math.round(Number(value) * 100);

export const computeShares = (totalPaise, type, participants) => {
  if (participants.length === 0) throw new HttpError(400, 'Choose at least one person to split with.');
  const ids = participants.map(p => p.personId);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Each person can only appear once in a split.');

  switch (type) {
    case 'equal': {
      const parts = allocate(totalPaise, participants.map(() => 1));
      // allocate() gives ties to earlier participants, which is what "payer first" needs
      return participants.map((p, i) => ({ personId: p.personId, paise: parts[i], weight: null }));
    }
    case 'exact': {
      const parts = participants.map(p => toPaise(p.value ?? 0));
      if (parts.some(p => p < 0)) throw new HttpError(400, 'Amounts can\'t be negative.');
      const sum = parts.reduce((a, b) => a + b, 0);
      if (sum !== totalPaise) {
        const diff = (totalPaise - sum) / 100;
        throw new HttpError(400, diff > 0
          ? `The amounts are ₹${diff.toFixed(2)} short of the total.`
          : `The amounts are ₹${(-diff).toFixed(2)} more than the total.`);
      }
      return participants.map((p, i) => ({ personId: p.personId, paise: parts[i], weight: null }));
    }
    case 'percent': {
      const weights = participants.map(p => hundredths(p.value ?? 0));
      if (weights.some(w => w < 0)) throw new HttpError(400, 'Percentages can\'t be negative.');
      if (weights.reduce((a, b) => a + b, 0) !== 10_000) throw new HttpError(400, 'Percentages must add up to 100.');
      const parts = allocate(totalPaise, weights);
      return participants.map((p, i) => ({ personId: p.personId, paise: parts[i], weight: weights[i] / 100 }));
    }
    case 'shares': {
      const weights = participants.map(p => hundredths(p.value ?? 0));
      if (weights.some(w => w < 0)) throw new HttpError(400, 'Shares can\'t be negative.');
      if (weights.every(w => w === 0)) throw new HttpError(400, 'Give at least one person a share.');
      const parts = allocate(totalPaise, weights);
      return participants.map((p, i) => ({ personId: p.personId, paise: parts[i], weight: weights[i] / 100 }));
    }
    default:
      throw new HttpError(400, 'Unknown split type.');
  }
};
