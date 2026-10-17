import { query, withTransaction } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { toPaise, toRupees } from '../lib/money.js';
import { computeShares } from '../lib/splits.js';
import { loadGroups } from './groupData.js';
import { ensureSelf, defaultLedger, copyShareToExpenses, removeShareExpense } from './ledger.js';

// ── Shapes sent to the client (rupees, your point of view) ──────────────────

const toMember = (m, nets) => ({
  id: m.id,
  name: m.is_self ? 'You' : m.name,
  isSelf: m.is_self,
  ledger: m.ledger_id ? { id: m.ledger_id, name: m.ledger_name } : null,
  archived: m.archived_at !== null,
  // Positive: the group owes them
  net: toRupees(nets.get(m.id) || 0),
});

const selfIdOf = (data) => data.members.find(m => m.is_self)?.id ?? null;

const summarize = (data) => {
  const selfId = selfIdOf(data);
  const dates = [
    ...data.expenses.map(e => e.spent_on),
    ...data.settlements.map(s => s.paid_on),
  ].sort();
  return {
    ...data.group,
    memberCount: data.members.length,
    totalSpent: toRupees(data.expenses.reduce((sum, e) => sum + e.amount_paise, 0)),
    // Your position in the group: positive, you're owed; negative, you owe
    myNet: toRupees(selfId ? data.nets.get(selfId) || 0 : 0),
    lastActivityOn: dates[dates.length - 1] ?? null,
  };
};

const toActivity = (data) => {
  const selfId = selfIdOf(data);
  const sumFor = (rows, id) => rows.filter(r => r.personId === id).reduce((sum, r) => sum + r.paise, 0);
  return [
    ...data.expenses.map(e => ({
      type: 'expense',
      id: e.id,
      description: e.description,
      amount: toRupees(e.amount_paise),
      date: e.spent_on,
      category: e.category,
      splitType: e.split_type,
      paidBy: e.payers.map(p => ({ personId: p.personId, amount: toRupees(p.paise) })),
      shares: e.shares.map(s => ({ personId: s.personId, amount: toRupees(s.paise), weight: s.weight })),
      myShare: toRupees(sumFor(e.shares, selfId)),
      // How this expense moved your position (positive: you're owed more)
      myEffect: toRupees(sumFor(e.payers, selfId) - sumFor(e.shares, selfId)),
      addedToExpenses: e.added_to_expenses,
      createdAt: e.created_at,
    })),
    ...data.settlements.map(s => ({
      type: 'settlement',
      id: s.id,
      from: s.from,
      to: s.to,
      amount: toRupees(s.paise),
      date: s.paid_on,
      note: s.note,
      createdAt: s.created_at,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || new Date(b.createdAt) - new Date(a.createdAt));
};

const loadOne = async (ownerId, groupId, db) => {
  const [data] = await loadGroups(ownerId, { groupIds: [groupId], db });
  if (!data) throw new HttpError(404, 'Group not found');
  return data;
};

// ── Groups ──────────────────────────────────────────────────────────────────

export const listGroups = async (user, { includeArchived = false } = {}) => {
  const all = await loadGroups(user.uuid);
  return all
    .filter(data => includeArchived || !data.group.archived)
    .map(summarize)
    .sort((a, b) => (b.lastActivityOn || b.createdAt.toISOString()).localeCompare(a.lastActivityOn || a.createdAt.toISOString()));
};

export const getGroup = async (user, groupId) => {
  const data = await loadOne(user.uuid, groupId);
  return {
    group: summarize(data),
    members: data.members.map(m => toMember(m, data.nets)),
    // Who should pay whom to clear the group, in the group's mode
    debts: data.debts.map(d => ({ from: d.from, to: d.to, amount: toRupees(d.paise) })),
    activity: toActivity(data),
  };
};

// Checks contact ids (must be yours and active) and creates people for new names in your
// default ledger. Returns the person ids to add.
const resolveMembers = async (client, ownerId, { memberIds = [], newMemberNames = [] }) => {
  const ids = [...new Set(memberIds)];
  if (ids.length) {
    const { rows } = await client.query(
      `select id from people
       where owner_id = $1 and id = any($2::uuid[]) and not is_self and archived_at is null`,
      [ownerId, ids]
    );
    if (rows.length !== ids.length) throw new HttpError(404, 'Some of those people were not found.');
  }

  const names = [...new Set(newMemberNames.map(n => n.trim()).filter(Boolean))];
  if (names.length) {
    const ledger = await defaultLedger(client, ownerId);
    for (const name of names) {
      const existing = await client.query(
        `select 1 from people where ledger_id = $1 and lower(btrim(name)) = lower($2) and archived_at is null and not is_self`,
        [ledger.id, name]
      );
      if (existing.rows[0]) {
        throw new HttpError(409, `You already have someone called "${name}" in ${ledger.name}. Pick them from the list instead.`);
      }
      const { rows } = await client.query(
        'insert into people (owner_id, ledger_id, name) values ($1, $2, $3) returning id',
        [ownerId, ledger.id, name]
      );
      ids.push(rows[0].id);
    }
  }
  return ids;
};

const addMembers = (client, ownerId, groupId, personIds) => Promise.all(personIds.map(personId =>
  client.query(
    `insert into group_members (owner_id, group_id, person_id) values ($1, $2, $3)
     on conflict (group_id, person_id) do nothing`,
    [ownerId, groupId, personId]
  )
));

export const createGroup = async (user, { name, emoji, simplifyDebts = false, memberIds, newMemberNames }) => {
  const groupId = await withTransaction(async (client) => {
    const selfId = await ensureSelf(client, user.uuid);
    const members = await resolveMembers(client, user.uuid, { memberIds, newMemberNames });
    if (members.length === 0) throw new HttpError(400, 'Add at least one other person to the group.');
    const { rows } = await client.query(
      'insert into groups (owner_id, name, emoji, simplify_debts) values ($1, $2, $3, $4) returning id',
      [user.uuid, name, emoji ?? null, simplifyDebts]
    );
    await addMembers(client, user.uuid, rows[0].id, [selfId, ...members]);
    return rows[0].id;
  });
  return getGroup(user, groupId);
};

const requireActiveGroup = async (db, ownerId, groupId) => {
  const { rows } = await db.query('select id, archived_at from groups where owner_id = $1 and id = $2', [ownerId, groupId]);
  if (!rows[0]) throw new HttpError(404, 'Group not found');
  if (rows[0].archived_at) throw new HttpError(409, 'That group is archived.');
};

export const updateGroup = async (user, groupId, { name, emoji, simplifyDebts, memberIds, newMemberNames }) => {
  await withTransaction(async (client) => {
    await requireActiveGroup(client, user.uuid, groupId);
    await client.query(
      `update groups set
         name = coalesce($3, name),
         emoji = case when $4::boolean then $5 else emoji end,
         simplify_debts = coalesce($6, simplify_debts),
         updated_at = now()
       where owner_id = $1 and id = $2`,
      [user.uuid, groupId, name ?? null, emoji !== undefined, emoji ?? null, simplifyDebts ?? null]
    );
    if (memberIds?.length || newMemberNames?.length) {
      const members = await resolveMembers(client, user.uuid, { memberIds, newMemberNames });
      await addMembers(client, user.uuid, groupId, members);
    }
  });
  return getGroup(user, groupId);
};

// ── Expenses ────────────────────────────────────────────────────────────────

export const addGroupExpense = async (user, groupId, input) => {
  const amountPaise = toPaise(input.amount);

  const { expenseId, mySharePaise } = await withTransaction(async (client) => {
    await requireActiveGroup(client, user.uuid, groupId);
    const data = await loadOne(user.uuid, groupId, client);
    const memberIds = new Set(data.members.map(m => m.id));
    const selfId = selfIdOf(data);

    if (!memberIds.has(input.paidById)) throw new HttpError(400, 'Whoever paid must be in the group.');
    const participants = input.split.participants;
    if (participants.some(p => !memberIds.has(p.personId))) {
      throw new HttpError(400, 'Everyone in the split must be in the group.');
    }

    // The payer goes first so an equal split's odd paisa stays with them
    const ordered = [...participants].sort((a, b) => (b.personId === input.paidById) - (a.personId === input.paidById));
    const shares = computeShares(amountPaise, input.split.type, ordered);

    const { rows } = await client.query(
      `insert into shared_expenses (owner_id, group_id, kind, description, amount_paise, spent_on, category, split_type)
       values ($1, $2, 'split', $3, $4, $5, $6, $7) returning id`,
      [user.uuid, groupId, input.description, amountPaise, input.date, input.category ?? null, input.split.type]
    );
    const expenseId = rows[0].id;
    await client.query(
      'insert into expense_payers (owner_id, expense_id, person_id, amount_paise) values ($1, $2, $3, $4)',
      [user.uuid, expenseId, input.paidById, amountPaise]
    );
    for (const share of shares) {
      await client.query(
        'insert into expense_shares (owner_id, expense_id, person_id, amount_paise, weight) values ($1, $2, $3, $4, $5)',
        [user.uuid, expenseId, share.personId, share.paise, share.weight]
      );
    }
    return { expenseId, mySharePaise: shares.find(s => s.personId === selfId)?.paise ?? 0 };
  });

  const myShareAdded = input.addMyShare && mySharePaise > 0
    ? await copyShareToExpenses(user, expenseId, {
        description: input.description, sharePaise: mySharePaise,
        category: input.category, paymentMethod: input.paymentMethod, date: input.date,
      })
    : false;

  return { id: expenseId, myShareAdded, ...(await getGroup(user, groupId)) };
};

export const deleteGroupExpense = async (user, groupId, expenseId) => {
  const { rows } = await query(
    'delete from shared_expenses where owner_id = $1 and group_id = $2 and id = $3 returning my_share_expense_id',
    [user.uuid, groupId, expenseId]
  );
  if (!rows[0]) throw new HttpError(404, 'Expense not found');
  return { myShareRemoved: await removeShareExpense(user, rows[0].my_share_expense_id) };
};

// ── Settlements ─────────────────────────────────────────────────────────────

// Any two members, e.g. "Neha paid Amit": you're keeping the whole group's books
export const addGroupSettlement = async (user, groupId, { fromPersonId, toPersonId, amount, date, note }) => {
  if (fromPersonId === toPersonId) throw new HttpError(400, 'Pick two different people.');
  await withTransaction(async (client) => {
    await requireActiveGroup(client, user.uuid, groupId);
    const { rows } = await client.query(
      'select person_id from group_members where owner_id = $1 and group_id = $2 and person_id = any($3::uuid[])',
      [user.uuid, groupId, [fromPersonId, toPersonId]]
    );
    if (rows.length !== 2) throw new HttpError(400, 'Both people must be in the group.');
    await client.query(
      `insert into settlements (owner_id, group_id, from_person_id, to_person_id, amount_paise, paid_on, note)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [user.uuid, groupId, fromPersonId, toPersonId, toPaise(amount), date, note ?? null]
    );
  });
  return getGroup(user, groupId);
};

export const deleteGroupSettlement = async (user, groupId, settlementId) => {
  const { rowCount } = await query(
    'delete from settlements where owner_id = $1 and group_id = $2 and id = $3',
    [user.uuid, groupId, settlementId]
  );
  if (rowCount === 0) throw new HttpError(404, 'Settlement not found');
};
