import test from 'node:test';
import assert from 'node:assert/strict';
import { computeShares } from '../lib/splits.js';

const people = (...ids) => ids.map(personId => ({ personId }));
const paise = (shares) => shares.map(s => s.paise);
const sum = (shares) => shares.reduce((total, s) => total + s.paise, 0);

test('equal: leftover paise go to the first participants (the payer is placed first)', () => {
  const shares = computeShares(10_000, 'equal', people('payer', 'b', 'c')); // ₹100 / 3
  assert.deepEqual(paise(shares), [3334, 3333, 3333]);
  assert.equal(sum(shares), 10_000);
});

test('exact: must add up to the total, with a helpful message when it does not', () => {
  const ok = computeShares(1000, 'exact', [{ personId: 'a', value: 7.5 }, { personId: 'b', value: 2.5 }]);
  assert.deepEqual(paise(ok), [750, 250]);
  assert.throws(
    () => computeShares(1000, 'exact', [{ personId: 'a', value: 5 }, { personId: 'b', value: 3 }]),
    /₹2\.00 short/
  );
  assert.throws(
    () => computeShares(1000, 'exact', [{ personId: 'a', value: 8 }, { personId: 'b', value: 3 }]),
    /₹1\.00 more/
  );
});

test('percent: needs exactly 100, and rounds by largest remainder', () => {
  const shares = computeShares(10_000, 'percent', [
    { personId: 'a', value: 33.33 }, { personId: 'b', value: 33.33 }, { personId: 'c', value: 33.34 },
  ]);
  assert.deepEqual(paise(shares), [3333, 3333, 3334]);
  assert.equal(shares[2].weight, 33.34);
  assert.throws(() => computeShares(10_000, 'percent', [{ personId: 'a', value: 50 }, { personId: 'b', value: 40 }]), /add up to 100/);
});

test('shares: weights split proportionally and always sum to the total', () => {
  const shares = computeShares(1001, 'shares', [
    { personId: 'couple', value: 2 }, { personId: 'b', value: 1 }, { personId: 'c', value: 1 },
  ]);
  assert.equal(sum(shares), 1001);
  assert.deepEqual(paise(shares), [501, 250, 250]); // 500.5 rounds up for the biggest remainder
  assert.throws(() => computeShares(1000, 'shares', [{ personId: 'a', value: 0 }]), /at least one person a share/);
});

test('rejects duplicates and empty splits', () => {
  assert.throws(() => computeShares(100, 'equal', []), /at least one person/);
  assert.throws(() => computeShares(100, 'equal', people('a', 'a')), /only appear once/);
});

test('every split type adds up exactly for awkward totals', () => {
  for (const total of [1, 7, 99, 100_001, 123_457]) {
    assert.equal(sum(computeShares(total, 'equal', people('a', 'b', 'c', 'd', 'e', 'f', 'g'))), total);
    assert.equal(sum(computeShares(total, 'shares', [
      { personId: 'a', value: 1.5 }, { personId: 'b', value: 2.25 }, { personId: 'c', value: 3 },
    ])), total);
  }
});
