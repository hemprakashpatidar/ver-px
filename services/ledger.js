import { query, withTransaction } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { toPaise, toRupees, splitEqually } from '../lib/money.js';
import * as transactions from './transactions.js';
import { groupAmountsByPerson } from './groupData.js';

// ── Balances ────────────────────────────────────────────────────────────────
// For a one-to-one entry (group_id is null) between you and person P:
//   P owes you = P's shares − what P paid − what P paid you back + what you paid P
// Positive: they owe you. Negative: you owe them.

// Every sum is cast to bigint: sum(bigint) is numeric in Postgres, which pg returns as a string,
// and "60000" + 5000 would concatenate instead of add.
const BALANCES_SQL = `
  with shares as (
    select s.person_id, sum(s.amount_paise)::bigint as total
    from expense_shares s join shared_expenses e on e.id = s.expense_id
    where s.owner_id = $1 and e.group_id is null
    group by s.person_id
  ), paid as (
    select p.person_id, sum(p.amount_paise)::bigint as total
    from expense_payers p join shared_expenses e on e.id = p.expense_id
    where p.owner_id = $1 and e.group_id is null
    group by p.person_id
  ), paid_back as (
    select from_person_id as person_id, sum(amount_paise)::bigint as total
    from settlements where owner_id = $1 and group_id is null
    group by from_person_id
  ), paid_to as (
    select to_person_id as person_id, sum(amount_paise)::bigint as total
    from settlements where owner_id = $1 and group_id is null
    group by to_person_id
  ), last_activity as (
    select person_id, max(day) as day from (
      select s.person_id, e.spent_on as day
      from expense_shares s join shared_expenses e on e.id = s.expense_id where s.owner_id = $1
      union all
      select p.person_id, e.spent_on
      from expense_payers p join shared_expenses e on e.id = p.expense_id where p.owner_id = $1
      union all
      select from_person_id, paid_on from settlements where owner_id = $1
      union all
      select to_person_id, paid_on from settlements where owner_id = $1
    ) activity group by person_id
  )
  select pe.id, pe.name, pe.archived_at, pe.ledger_id, lg.name as ledger_name,
         coalesce(sh.total, 0) - coalesce(pd.total, 0) - coalesce(pb.total, 0) + coalesce(pt.total, 0) as balance_paise,
         la.day as last_activity_on
  from people pe
  left join shares sh on sh.person_id = pe.id
  left join paid pd on pd.person_id = pe.id
  left join paid_back pb on pb.person_id = pe.id
  left join paid_to pt on pt.person_id = pe.id
  left join last_activity la on la.person_id = pe.id
  left join ledgers lg on lg.id = pe.ledger_id
  where pe.owner_id = $1 and not pe.is_self`;

// row.balance_paise is the one-to-one balance; groupParts adds what's between you in groups
const combinedPaise = (row, groupParts = []) =>
  Number(row.balance_paise) + groupParts.reduce((sum, part) => sum + part.paise, 0);

const toPerson = (row, groupParts = []) => ({
  id: row.id,
  name: row.name,
  ledger: { id: row.ledger_id, name: row.ledger_name },
  archived: row.archived_at !== null,
  // Combined: direct entries plus every group
  balance: toRupees(combinedPaise(row, groupParts)),
  directBalance: toRupees(row.balance_paise),
  groupBalances: groupParts.map(part => ({
    groupId: part.groupId, name: part.name, emoji: part.emoji, balance: toRupees(part.paise),
  })),
  lastActivityOn: row.last_activity_on,
});

// Your "self" person id without creating it (null before you've added anyone)
const findSelfId = async (ownerId) => {
  const { rows } = await query('select id from people where owner_id = $1 and is_self', [ownerId]);
  return rows[0]?.id ?? null;
};

const groupPartsFor = async (ownerId) => groupAmountsByPerson(ownerId, await findSelfId(ownerId));

const loadPerson = async (ownerId, personId, db = { query }) => {
  const { rows } = await db.query(`${BALANCES_SQL} and pe.id = $2`, [ownerId, personId]);
  if (!rows[0]) throw new HttpError(404, 'Person not found');
  return rows[0];
};

// The person's row plus their group parts, ready for toPerson / balance checks
const loadPersonWithGroups = async (ownerId, personId) => {
  const [row, groupParts] = await Promise.all([loadPerson(ownerId, personId), groupPartsFor(ownerId)]);
  return { row, groupParts: groupParts.get(personId) || [] };
};

// "You" as a person row, created the first time it's needed
export const ensureSelf = async (client, ownerId) => {
  const inserted = await client.query(
    `insert into people (owner_id, name, is_self) values ($1, 'You', true)
     on conflict (owner_id) where is_self do nothing
     returning id`,
    [ownerId]
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const { rows } = await client.query('select id from people where owner_id = $1 and is_self', [ownerId]);
  return rows[0].id;
};

// The person must be one of yours, still active, and not "you"
const requireActivePerson = async (client, ownerId, personId) => {
  const { rows } = await client.query(
    `select p.id, p.name, l.archived_at as ledger_archived_at
     from people p join ledgers l on l.id = p.ledger_id
     where p.owner_id = $1 and p.id = $2 and not p.is_self and p.archived_at is null`,
    [ownerId, personId]
  );
  if (!rows[0]) throw new HttpError(404, 'Person not found');
  if (rows[0].ledger_archived_at) throw new HttpError(409, 'That ledger is archived. Restore it to add entries.');
  return rows[0];
};

// ── Ledgers ─────────────────────────────────────────────────────────────────

const DEFAULT_LEDGER_NAME = 'Personal';

const toLedger = (row) => ({ id: row.id, name: row.name, archived: row.archived_at !== null });

// Your oldest active ledger, creating "Personal" the first time. The unique-name index
// makes two simultaneous first requests agree on one ledger.
export const defaultLedger = async (db, ownerId) => {
  const existing = await db.query(
    'select id, name, archived_at from ledgers where owner_id = $1 and archived_at is null order by created_at limit 1',
    [ownerId]
  );
  if (existing.rows[0]) return existing.rows[0];
  await db.query(
    `insert into ledgers (owner_id, name) values ($1, $2)
     on conflict (owner_id, lower(btrim(name))) where archived_at is null do nothing`,
    [ownerId, DEFAULT_LEDGER_NAME]
  );
  const created = await db.query(
    'select id, name, archived_at from ledgers where owner_id = $1 and archived_at is null order by created_at limit 1',
    [ownerId]
  );
  return created.rows[0];
};

// The requested ledger (must be yours), or your default one when none is given
const resolveLedger = async (db, ownerId, ledgerId, { mustBeActive = false } = {}) => {
  if (!ledgerId) return defaultLedger(db, ownerId);
  const { rows } = await db.query(
    'select id, name, archived_at from ledgers where owner_id = $1 and id = $2',
    [ownerId, ledgerId]
  );
  if (!rows[0]) throw new HttpError(404, 'Ledger not found');
  if (mustBeActive && rows[0].archived_at) throw new HttpError(409, 'That ledger is archived. Restore it first.');
  return rows[0];
};

const duplicateLedger = (name) => new HttpError(409, `You already have a ledger called "${name}".`);

// Every ledger with its totals, oldest first
export const listLedgers = async (user, { includeArchived = false } = {}) => {
  await defaultLedger({ query }, user.uuid);
  const [ledgers, balances, groupParts] = await Promise.all([
    query(
      `select id, name, archived_at from ledgers
       where owner_id = $1 ${includeArchived ? '' : 'and archived_at is null'}
       order by created_at`,
      [user.uuid]
    ),
    query(`${BALANCES_SQL} and pe.archived_at is null`, [user.uuid]),
    groupPartsFor(user.uuid),
  ]);

  return ledgers.rows.map(ledger => {
    const people = balances.rows.filter(p => p.ledger_id === ledger.id)
      .map(p => combinedPaise(p, groupParts.get(p.id)));
    const owedToYou = people.reduce((sum, b) => sum + Math.max(b, 0), 0);
    const youOwe = people.reduce((sum, b) => sum + Math.max(-b, 0), 0);
    return {
      ...toLedger(ledger),
      peopleCount: people.length,
      totals: { owedToYou: toRupees(owedToYou), youOwe: toRupees(youOwe) },
    };
  });
};

export const createLedger = async (user, { name }) => {
  try {
    const { rows } = await query(
      'insert into ledgers (owner_id, name) values ($1, $2) returning id, name, archived_at',
      [user.uuid, name]
    );
    return toLedger(rows[0]);
  } catch (error) {
    if (error.code === '23505') throw duplicateLedger(name);
    throw error;
  }
};

export const updateLedger = async (user, ledgerId, { name, archived }) => {
  const ledger = await resolveLedger({ query }, user.uuid, ledgerId);

  if (archived === true && !ledger.archived_at) {
    const [{ rows: people }, groupParts] = await Promise.all([
      query(`${BALANCES_SQL} and pe.ledger_id = $2`, [user.uuid, ledgerId]),
      groupPartsFor(user.uuid),
    ]);
    if (people.some(p => combinedPaise(p, groupParts.get(p.id)) !== 0)) {
      throw new HttpError(409, `Settle up with everyone in ${ledger.name} before archiving it.`);
    }
    const { rows } = await query(
      'select count(*)::int as active from ledgers where owner_id = $1 and archived_at is null',
      [user.uuid]
    );
    if (rows[0].active <= 1) throw new HttpError(409, 'You need at least one active ledger.');
  }

  try {
    const { rows } = await query(
      `update ledgers set
         name = coalesce($3, name),
         archived_at = case when $4::boolean is null then archived_at
                            when $4 then coalesce(archived_at, now())
                            else null end,
         updated_at = now()
       where owner_id = $1 and id = $2
       returning id, name, archived_at`,
      [user.uuid, ledgerId, name ?? null, archived ?? null]
    );
    return toLedger(rows[0]);
  } catch (error) {
    if (error.code === '23505') throw duplicateLedger(name ?? ledger.name);
    throw error;
  }
};

// ── People ──────────────────────────────────────────────────────────────────

export const listPeople = async (user, { ledgerId, allLedgers = false, includeArchived = false } = {}) => {
  // allLedgers: everyone, with each person's ledger on them; `ledger` in the response is null
  const ledger = allLedgers ? null : await resolveLedger({ query }, user.uuid, ledgerId);
  const archivedFilter = includeArchived ? '' : 'and pe.archived_at is null';
  const [{ rows }, groupParts] = await Promise.all([
    allLedgers
      ? query(`${BALANCES_SQL} ${archivedFilter}`, [user.uuid])
      : query(`${BALANCES_SQL} and pe.ledger_id = $2 ${archivedFilter}`, [user.uuid, ledger.id]),
    groupPartsFor(user.uuid),
  ]);
  const people = rows.map(r => toPerson(r, groupParts.get(r.id)))
    // People you're square with sink to the bottom; the rest by size of balance
    .sort((a, b) => (Math.abs(b.balance) - Math.abs(a.balance)) || a.name.localeCompare(b.name));

  const combined = rows.map(r => combinedPaise(r, groupParts.get(r.id)));
  const owedToYou = combined.reduce((sum, b) => sum + Math.max(b, 0), 0);
  const youOwe = combined.reduce((sum, b) => sum + Math.max(-b, 0), 0);
  return {
    ledger: ledger ? toLedger(ledger) : null,
    people,
    totals: { owedToYou: toRupees(owedToYou), youOwe: toRupees(youOwe) },
  };
};

const duplicateName = (name) => new HttpError(409, `There's already someone called "${name}" in this ledger.`);

export const createPerson = async (user, { name, ledgerId }) => {
  try {
    const id = await withTransaction(async (client) => {
      await ensureSelf(client, user.uuid);
      const ledger = await resolveLedger(client, user.uuid, ledgerId, { mustBeActive: true });
      const { rows } = await client.query(
        'insert into people (owner_id, ledger_id, name) values ($1, $2, $3) returning id',
        [user.uuid, ledger.id, name]
      );
      return rows[0].id;
    });
    return toPerson(await loadPerson(user.uuid, id));
  } catch (error) {
    if (error.code === '23505') throw duplicateName(name);
    throw error;
  }
};

// name, archive, or move to another ledger (their whole history moves with them)
export const updatePerson = async (user, personId, { name, archived, ledgerId }) => {
  const { row: current, groupParts } = await loadPersonWithGroups(user.uuid, personId);
  if (archived === true && combinedPaise(current, groupParts) !== 0) {
    throw new HttpError(409, `Settle up with ${current.name} before archiving them.`);
  }
  if (ledgerId) await resolveLedger({ query }, user.uuid, ledgerId, { mustBeActive: true });
  try {
    await query(
      `update people set
         name = coalesce($3, name),
         archived_at = case when $4::boolean is null then archived_at
                            when $4 then coalesce(archived_at, now())
                            else null end,
         ledger_id = coalesce($5, ledger_id),
         updated_at = now()
       where owner_id = $1 and id = $2 and not is_self`,
      [user.uuid, personId, name ?? null, archived ?? null, ledgerId ?? null]
    );
  } catch (error) {
    if (error.code === '23505') throw duplicateName(name ?? current.name);
    throw error;
  }
  const updated = await loadPersonWithGroups(user.uuid, personId);
  return toPerson(updated.row, updated.groupParts);
};

// A person with their balance and everything that happened between you, newest first.
// Group activity stays on each group's page; the person carries the per-group amounts.
export const getPerson = async (user, personId) => {
  const loaded = await loadPersonWithGroups(user.uuid, personId);
  const person = toPerson(loaded.row, loaded.groupParts);

  const [expenses, settlements] = await Promise.all([
    query(
      `select e.id, e.kind, e.description, e.amount_paise, e.spent_on, e.category, e.created_at,
              e.my_share_expense_id is not null as added_to_expenses,
              coalesce((select sum(amount_paise)::bigint from expense_payers where expense_id = e.id and person_id = $2), 0) as their_paid,
              coalesce((select sum(amount_paise)::bigint from expense_shares where expense_id = e.id and person_id = $2), 0) as their_share
       from shared_expenses e
       where e.owner_id = $1 and e.group_id is null
         and (exists (select 1 from expense_payers where expense_id = e.id and person_id = $2)
              or exists (select 1 from expense_shares where expense_id = e.id and person_id = $2))`,
      [user.uuid, personId]
    ),
    query(
      `select id, from_person_id, amount_paise, paid_on, note, created_at
       from settlements
       where owner_id = $1 and group_id is null and (from_person_id = $2 or to_person_id = $2)`,
      [user.uuid, personId]
    ),
  ]);

  const activity = [
    ...expenses.rows.map(e => ({
      type: e.kind === 'loan' ? (e.their_paid > 0 ? 'borrowed' : 'lent') : 'split',
      id: e.id,
      description: e.description,
      amount: toRupees(e.amount_paise),
      date: e.spent_on,
      category: e.category,
      paidBy: e.their_paid > 0 ? 'them' : 'me',
      theirShare: toRupees(e.their_share),
      myShare: toRupees(e.amount_paise - e.their_share),
      addedToExpenses: e.added_to_expenses,
      // How this entry moved the balance (positive: they owe you more)
      effect: toRupees(e.their_share - e.their_paid),
      createdAt: e.created_at,
    })),
    ...settlements.rows.map(s => {
      const theyPaid = s.from_person_id === personId;
      return {
        type: 'settlement',
        id: s.id,
        direction: theyPaid ? 'they_paid' : 'i_paid',
        amount: toRupees(s.amount_paise),
        date: s.paid_on,
        note: s.note,
        effect: toRupees(theyPaid ? -s.amount_paise : s.amount_paise),
        createdAt: s.created_at,
      };
    }),
  ].sort((a, b) => b.date.localeCompare(a.date) || new Date(b.createdAt) - new Date(a.createdAt));

  return { person, activity };
};

// ── Entries ─────────────────────────────────────────────────────────────────

// Who paid and who owes, for the three one-to-one entry types
const planEntry = (input, amountPaise, selfId, personId) => {
  if (input.type === 'lent') {
    return { kind: 'loan', payers: [[selfId, amountPaise]], shares: [[personId, amountPaise]] };
  }
  if (input.type === 'borrowed') {
    return { kind: 'loan', payers: [[personId, amountPaise]], shares: [[selfId, amountPaise]] };
  }
  // split
  const iPaid = input.paidBy === 'me';
  let myShare;
  if (input.split.mode === 'equal') {
    // Index 0 is me; the payer keeps any odd paisa
    [myShare] = splitEqually(amountPaise, 2, iPaid ? 0 : 1);
  } else {
    myShare = toPaise(input.split.myShare);
    if (myShare > amountPaise) throw new HttpError(400, 'Your share can\'t be more than the total.');
  }
  return {
    kind: 'split',
    payers: [[iPaid ? selfId : personId, amountPaise]],
    shares: [[selfId, myShare], [personId, amountPaise - myShare]],
    myShare,
  };
};

const DEFAULT_DESCRIPTIONS = { lent: 'Money lent', borrowed: 'Money borrowed' };

// "Add my share to my expenses": a normal expense in Notion for your part of a bill.
// Called after the shared expense is saved; if Notion fails the entry stays and this returns false.
export const copyShareToExpenses = async (user, expenseId, { description, sharePaise, category, paymentMethod, date }) => {
  try {
    const expense = await transactions.create(user, {
      expense: description, amount: toRupees(sharePaise), category, paymentMethod, date,
    });
    await query(
      'update shared_expenses set my_share_expense_id = $3, updated_at = now() where owner_id = $1 and id = $2',
      [user.uuid, expenseId, expense.id]
    );
    return true;
  } catch (error) {
    console.error('Adding my share to expenses failed:', error);
    return false;
  }
};

// Removes the Notion expense "add my share" created. null when there was none.
export const removeShareExpense = async (user, notionExpenseId) => {
  if (!notionExpenseId) return null;
  try {
    await transactions.remove(user, notionExpenseId);
    return true;
  } catch (error) {
    console.error('Removing my share expense failed:', error);
    return false;
  }
};

export const createEntry = async (user, input) => {
  const amountPaise = toPaise(input.amount);
  const description = input.description || DEFAULT_DESCRIPTIONS[input.type];

  const { entryId, plan } = await withTransaction(async (client) => {
    const selfId = await ensureSelf(client, user.uuid);
    await requireActivePerson(client, user.uuid, input.personId);
    const plan = planEntry(input, amountPaise, selfId, input.personId);

    const { rows } = await client.query(
      `insert into shared_expenses (owner_id, kind, description, amount_paise, spent_on, category)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [user.uuid, plan.kind, description, amountPaise, input.date, input.category ?? null]
    );
    const entryId = rows[0].id;

    for (const [personId, paise] of plan.payers) {
      await client.query(
        'insert into expense_payers (owner_id, expense_id, person_id, amount_paise) values ($1, $2, $3, $4)',
        [user.uuid, entryId, personId, paise]
      );
    }
    for (const [personId, paise] of plan.shares) {
      await client.query(
        'insert into expense_shares (owner_id, expense_id, person_id, amount_paise) values ($1, $2, $3, $4)',
        [user.uuid, entryId, personId, paise]
      );
    }
    return { entryId, plan };
  });

  const myShareAdded = input.type === 'split' && input.addMyShare && plan.myShare > 0
    ? await copyShareToExpenses(user, entryId, {
        description, sharePaise: plan.myShare, category: input.category, paymentMethod: input.paymentMethod, date: input.date,
      })
    : false;

  const { person } = await getPerson(user, input.personId);
  return { id: entryId, myShareAdded, person };
};

export const deleteEntry = async (user, entryId) => {
  const { rows } = await query(
    'delete from shared_expenses where owner_id = $1 and id = $2 and group_id is null returning my_share_expense_id',
    [user.uuid, entryId]
  );
  if (!rows[0]) throw new HttpError(404, 'Entry not found');

  // Remove the matching expense too, if "add my share" created one
  return { myShareRemoved: await removeShareExpense(user, rows[0].my_share_expense_id) };
};

// ── Settlements ─────────────────────────────────────────────────────────────

const insertSettlement = (client, ownerId, { groupId = null, from, to, paise, date, note }) =>
  client.query(
    `insert into settlements (owner_id, group_id, from_person_id, to_person_id, amount_paise, paid_on, note)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [ownerId, groupId, from, to, paise, date, note ?? null]
  );

// scope 'direct' (default): one-to-one only. { groupId }: inside that group.
// 'all': clears the whole combined balance, one settlement per part (direct and each group),
// so every part reaches zero; `amount` must match the combined balance.
export const createSettlement = async (user, { personId, direction, amount, date, note, scope = 'direct', groupId }) => {
  await withTransaction(async (client) => {
    const selfId = await ensureSelf(client, user.uuid);
    await requireActivePerson(client, user.uuid, personId);
    const paise = toPaise(amount);
    const [from, to] = direction === 'they_paid' ? [personId, selfId] : [selfId, personId];

    if (scope === 'direct') {
      await insertSettlement(client, user.uuid, { from, to, paise, date, note });
      return;
    }

    if (scope === 'group') {
      const { rows } = await client.query(
        `select 1 from group_members m join groups g on g.id = m.group_id
         where m.owner_id = $1 and m.group_id = $2 and m.person_id = $3 and g.archived_at is null`,
        [user.uuid, groupId, personId]
      );
      if (!rows[0]) throw new HttpError(404, 'They are not in that group.');
      await insertSettlement(client, user.uuid, { groupId, from, to, paise, date, note });
      return;
    }

    // scope === 'all'
    const { row, groupParts } = await loadPersonWithGroups(user.uuid, personId);
    const parts = [{ groupId: null, paise: row.balance_paise }, ...groupParts].filter(p => p.paise !== 0);
    const total = parts.reduce((sum, p) => sum + p.paise, 0);
    const expected = direction === 'they_paid' ? total : -total;
    if (paise !== expected) {
      throw new HttpError(409, 'The balance changed since you opened this. Refresh and try again.');
    }
    for (const part of parts) {
      // part > 0: they owe you in that part, so they pay you; < 0: you pay them
      const [partFrom, partTo] = part.paise > 0 ? [personId, selfId] : [selfId, personId];
      await insertSettlement(client, user.uuid, {
        groupId: part.groupId, from: partFrom, to: partTo, paise: Math.abs(part.paise), date, note,
      });
    }
  });
  const { person } = await getPerson(user, personId);
  return { person };
};

export const deleteSettlement = async (user, settlementId) => {
  const { rowCount } = await query(
    'delete from settlements where owner_id = $1 and id = $2 and group_id is null',
    [user.uuid, settlementId]
  );
  if (rowCount === 0) throw new HttpError(404, 'Settlement not found');
};
