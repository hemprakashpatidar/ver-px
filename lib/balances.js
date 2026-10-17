// Group balance maths, on integer paise. Pure functions over plain data:
//   expenses:    [{ payers: [{ personId, paise }], shares: [{ personId, paise }] }]
//   settlements: [{ from, to, paise }]   (from handed money to to)
// A debt is { from, to, paise }: `from` owes `to`.

// Each member's position: positive means the group owes them
export const groupNets = (expenses, settlements) => {
  const nets = new Map();
  const add = (id, paise) => nets.set(id, (nets.get(id) || 0) + paise);
  for (const e of expenses) {
    for (const p of e.payers) add(p.personId, p.paise);
    for (const s of e.shares) add(s.personId, -s.paise);
  }
  for (const s of settlements) {
    add(s.from, s.paise);
    add(s.to, -s.paise);
  }
  return nets;
};

// "Simplify debts": the fewest payments that clear every net, by repeatedly pairing whoever
// owes most with whoever is owed most. Ties break by id so results are stable.
export const simplifyDebts = (nets) => {
  const debtors = [];
  const creditors = [];
  for (const [id, net] of nets) {
    if (net < 0) debtors.push({ id, amount: -net });
    else if (net > 0) creditors.push({ id, amount: net });
  }
  const byAmount = (a, b) => b.amount - a.amount || String(a.id).localeCompare(String(b.id));
  const debts = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byAmount);
    creditors.sort(byAmount);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const paise = Math.min(debtor.amount, creditor.amount);
    debts.push({ from: debtor.id, to: creditor.id, paise });
    debtor.amount -= paise;
    creditor.amount -= paise;
    if (debtor.amount === 0) debtors.shift();
    if (creditor.amount === 0) creditors.shift();
  }
  return debts;
};

// Without simplifying: every participant owes the payer their share, then each pair is
// netted (and reduced by settlements between them). With several payers, a share is owed
// to the payers in proportion to what each paid.
export const pairwiseDebts = (expenses, settlements) => {
  // owed["a|b"] > 0 means a owes b, with a < b in id order
  const owed = new Map();
  const add = (debtor, creditor, paise) => {
    if (debtor === creditor || paise === 0) return;
    const [a, b, sign] = String(debtor) < String(creditor) ? [debtor, creditor, 1] : [creditor, debtor, -1];
    const key = `${a}|${b}`;
    owed.set(key, (owed.get(key) || 0) + sign * paise);
  };

  for (const e of expenses) {
    const paidTotal = e.payers.reduce((sum, p) => sum + p.paise, 0);
    for (const share of e.shares) {
      if (e.payers.length === 1) {
        add(share.personId, e.payers[0].personId, share.paise);
        continue;
      }
      // Split this share across payers in whole paise, the remainder to the first payer
      let left = share.paise;
      e.payers.forEach((payer, i) => {
        const part = i === e.payers.length - 1 ? left : Math.floor((share.paise * payer.paise) / paidTotal);
        add(share.personId, payer.personId, part);
        left -= part;
      });
    }
  }
  // A settlement from -> to pays down what from owed to (or creates a debt the other way)
  for (const s of settlements) add(s.to, s.from, s.paise);

  const debts = [];
  for (const [key, paise] of owed) {
    if (paise === 0) continue;
    const [a, b] = key.split('|');
    debts.push(paise > 0 ? { from: a, to: b, paise } : { from: b, to: a, paise: -paise });
  }
  return debts.sort((x, y) => y.paise - x.paise);
};

// The group's debts in the mode the group uses
export const groupDebts = (group, expenses, settlements) =>
  group.simplifyDebts ? simplifyDebts(groupNets(expenses, settlements)) : pairwiseDebts(expenses, settlements);

// What `otherId` owes `selfId` in a list of debts (negative: self owes them)
export const amountBetween = (debts, selfId, otherId) => debts.reduce((sum, d) => {
  if (d.from === otherId && d.to === selfId) return sum + d.paise;
  if (d.from === selfId && d.to === otherId) return sum - d.paise;
  return sum;
}, 0);
