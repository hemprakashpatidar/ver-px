import test from 'node:test';
import assert from 'node:assert/strict';
import { groupNets, simplifyDebts, pairwiseDebts, amountBetween } from '../lib/balances.js';

// You paid ₹900 dinner for you, A, B equally; A paid ₹300 cab for A and B
const expenses = [
  { payers: [{ personId: 'me', paise: 90_000 }], shares: ['me', 'a', 'b'].map(personId => ({ personId, paise: 30_000 })) },
  { payers: [{ personId: 'a', paise: 30_000 }], shares: ['a', 'b'].map(personId => ({ personId, paise: 15_000 })) },
];

const netsOf = (debts) => debts.reduce((map, d) => {
  map[d.from] = (map[d.from] || 0) - d.paise;
  map[d.to] = (map[d.to] || 0) + d.paise;
  return map;
}, {});

test('nets: paid minus shares, adjusted by settlements', () => {
  const nets = groupNets(expenses, []);
  assert.deepEqual(Object.fromEntries(nets), { me: 60_000, a: -15_000, b: -45_000 });
  const after = groupNets(expenses, [{ from: 'b', to: 'me', paise: 45_000 }]);
  assert.equal(after.get('b'), 0);
  assert.equal(after.get('me'), 15_000);
});

test('pairwise: participants owe the payer, pairs are netted', () => {
  const debts = pairwiseDebts(expenses, []);
  assert.equal(amountBetween(debts, 'me', 'a'), 30_000); // A owes you their dinner share
  assert.equal(amountBetween(debts, 'me', 'b'), 30_000);
  assert.equal(amountBetween(debts, 'a', 'b'), 15_000); // B owes A for the cab
});

test('pairwise and simplified always agree on every member\'s net', () => {
  const settlements = [{ from: 'b', to: 'a', paise: 5_000 }];
  const nets = Object.fromEntries(groupNets(expenses, settlements));
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0));
  assert.deepEqual(clean(netsOf(pairwiseDebts(expenses, settlements))), clean(nets));
  assert.deepEqual(clean(netsOf(simplifyDebts(groupNets(expenses, settlements)))), clean(nets));
});

test('simplify: fewest payments, whoever owes most pays whoever is owed most', () => {
  const debts = simplifyDebts(groupNets(expenses, []));
  assert.deepEqual(debts, [
    { from: 'b', to: 'me', paise: 45_000 },
    { from: 'a', to: 'me', paise: 15_000 },
  ]);
});

test('a settlement can flip a pair\'s direction', () => {
  const debts = pairwiseDebts(expenses, [{ from: 'a', to: 'me', paise: 50_000 }]); // A overpaid you
  assert.equal(amountBetween(debts, 'me', 'a'), -20_000);
});

test('several payers: a share is owed in proportion to what each paid, in whole paise', () => {
  const debts = pairwiseDebts([{
    payers: [{ personId: 'me', paise: 2_000 }, { personId: 'a', paise: 1_000 }],
    shares: [{ personId: 'b', paise: 1_001 }, { personId: 'me', paise: 1_000 }, { personId: 'a', paise: 999 }],
  }], []);
  assert.equal(amountBetween(debts, 'me', 'b') + amountBetween(debts, 'a', 'b'), 1_001);
});
