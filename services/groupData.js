import { query } from '../lib/db.js';
import { groupDebts, groupNets, amountBetween } from '../lib/balances.js';

// Loads groups with everything needed for balances, in one round of queries.
// Returns [{ group, members, expenses, settlements, debts, nets }], oldest group first.
export const loadGroups = async (ownerId, { groupIds = null, db = { query } } = {}) => {
  const filter = groupIds ? 'and g.id = any($2::uuid[])' : '';
  const params = groupIds ? [ownerId, groupIds] : [ownerId];

  const [groups, members, expenses, payers, shares, settlements] = await Promise.all([
    db.query(
      `select g.id, g.name, g.emoji, g.simplify_debts, g.archived_at, g.created_at
       from groups g where g.owner_id = $1 ${filter} order by g.created_at`,
      params
    ),
    db.query(
      `select m.group_id, p.id, p.name, p.is_self, p.archived_at, p.ledger_id, l.name as ledger_name
       from group_members m
       join people p on p.id = m.person_id
       left join ledgers l on l.id = p.ledger_id
       join groups g on g.id = m.group_id
       where m.owner_id = $1 ${filter}
       order by p.is_self desc, m.joined_at, p.name`,
      params
    ),
    db.query(
      `select e.id, e.group_id, e.description, e.amount_paise, e.spent_on, e.category, e.split_type,
              e.my_share_expense_id is not null as added_to_expenses, e.created_at
       from shared_expenses e join groups g on g.id = e.group_id
       where e.owner_id = $1 ${filter}`,
      params
    ),
    db.query(
      `select p.expense_id, p.person_id, p.amount_paise
       from expense_payers p
       join shared_expenses e on e.id = p.expense_id
       join groups g on g.id = e.group_id
       where p.owner_id = $1 ${filter}`,
      params
    ),
    db.query(
      `select s.expense_id, s.person_id, s.amount_paise, s.weight
       from expense_shares s
       join shared_expenses e on e.id = s.expense_id
       join groups g on g.id = e.group_id
       where s.owner_id = $1 ${filter}`,
      params
    ),
    db.query(
      `select s.id, s.group_id, s.from_person_id, s.to_person_id, s.amount_paise, s.paid_on, s.note, s.created_at
       from settlements s join groups g on g.id = s.group_id
       where s.owner_id = $1 ${filter}`,
      params
    ),
  ]);

  const byExpense = (rows) => rows.reduce((map, r) => {
    if (!map.has(r.expense_id)) map.set(r.expense_id, []);
    map.get(r.expense_id).push(r);
    return map;
  }, new Map());
  const payersByExpense = byExpense(payers.rows);
  const sharesByExpense = byExpense(shares.rows);

  return groups.rows.map(row => {
    const group = {
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      simplifyDebts: row.simplify_debts,
      archived: row.archived_at !== null,
      createdAt: row.created_at,
    };
    const groupExpenses = expenses.rows.filter(e => e.group_id === row.id).map(e => ({
      ...e,
      payers: (payersByExpense.get(e.id) || []).map(p => ({ personId: p.person_id, paise: p.amount_paise })),
      shares: (sharesByExpense.get(e.id) || []).map(s => ({
        personId: s.person_id, paise: s.amount_paise, weight: s.weight === null ? null : Number(s.weight),
      })),
    }));
    const groupSettlements = settlements.rows.filter(s => s.group_id === row.id).map(s => ({
      ...s, from: s.from_person_id, to: s.to_person_id, paise: s.amount_paise,
    }));
    return {
      group,
      members: members.rows.filter(m => m.group_id === row.id),
      expenses: groupExpenses,
      settlements: groupSettlements,
      nets: groupNets(groupExpenses, groupSettlements),
      debts: groupDebts(group, groupExpenses, groupSettlements),
    };
  });
};

// What each person owes you across groups, from each group's debts (in its own mode):
// Map personId -> [{ groupId, name, emoji, paise }] with only non-zero amounts.
export const groupAmountsByPerson = async (ownerId, selfId) => {
  const result = new Map();
  if (!selfId) return result;
  for (const data of await loadGroups(ownerId)) {
    for (const member of data.members) {
      if (member.id === selfId) continue;
      const paise = amountBetween(data.debts, selfId, member.id);
      if (paise === 0) continue;
      if (!result.has(member.id)) result.set(member.id, []);
      result.get(member.id).push({ groupId: data.group.id, name: data.group.name, emoji: data.group.emoji, paise });
    }
  }
  return result;
};
