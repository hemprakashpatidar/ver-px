import { query, withTransaction } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { toPaise, toRupees, splitEqually } from '../lib/money.js';
import * as transactions from './transactions.js';

// ── Balances ────────────────────────────────────────────────────────────────
// For a one-to-one entry (group_id is null) between you and person P:
//   P owes you = P's shares − what P paid − what P paid you back + what you paid P
// Positive: they owe you. Negative: you owe them.

const BALANCES_SQL = `
  with shares as (
    select s.person_id, sum(s.amount_paise) as total
    from expense_shares s join shared_expenses e on e.id = s.expense_id
    where s.owner_id = $1 and e.group_id is null
    group by s.person_id
  ), paid as (
    select p.person_id, sum(p.amount_paise) as total
    from expense_payers p join shared_expenses e on e.id = p.expense_id
    where p.owner_id = $1 and e.group_id is null
    group by p.person_id
  ), paid_back as (
    select from_person_id as person_id, sum(amount_paise) as total
    from settlements where owner_id = $1 and group_id is null
    group by from_person_id
  ), paid_to as (
    select to_person_id as person_id, sum(amount_paise) as total
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
  select pe.id, pe.name, pe.archived_at,
         coalesce(sh.total, 0) - coalesce(pd.total, 0) - coalesce(pb.total, 0) + coalesce(pt.total, 0) as balance_paise,
         la.day as last_activity_on
  from people pe
  left join shares sh on sh.person_id = pe.id
  left join paid pd on pd.person_id = pe.id
  left join paid_back pb on pb.person_id = pe.id
  left join paid_to pt on pt.person_id = pe.id
  left join last_activity la on la.person_id = pe.id
  where pe.owner_id = $1 and not pe.is_self`;

const toPerson = (row) => ({
  id: row.id,
  name: row.name,
  archived: row.archived_at !== null,
  balance: toRupees(row.balance_paise),
  lastActivityOn: row.last_activity_on,
});

const loadPerson = async (ownerId, personId, db = { query }) => {
  const { rows } = await db.query(`${BALANCES_SQL} and pe.id = $2`, [ownerId, personId]);
  if (!rows[0]) throw new HttpError(404, 'Person not found');
  return rows[0];
};

// "You" as a person row, created the first time it's needed
const ensureSelf = async (client, ownerId) => {
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
    'select id, name from people where owner_id = $1 and id = $2 and not is_self and archived_at is null',
    [ownerId, personId]
  );
  if (!rows[0]) throw new HttpError(404, 'Person not found');
  return rows[0];
};

// ── People ──────────────────────────────────────────────────────────────────

export const listPeople = async (user, { includeArchived = false } = {}) => {
  const { rows } = await query(
    `${BALANCES_SQL} ${includeArchived ? '' : 'and pe.archived_at is null'}`,
    [user.uuid]
  );
  const people = rows.map(toPerson)
    // People you're square with sink to the bottom; the rest by size of balance
    .sort((a, b) => (Math.abs(b.balance) - Math.abs(a.balance)) || a.name.localeCompare(b.name));

  const owedToYou = rows.reduce((sum, r) => sum + Math.max(r.balance_paise, 0), 0);
  const youOwe = rows.reduce((sum, r) => sum + Math.max(-r.balance_paise, 0), 0);
  return { people, totals: { owedToYou: toRupees(owedToYou), youOwe: toRupees(youOwe) } };
};

const duplicateName = (name) => new HttpError(409, `You already have someone called "${name}".`);

export const createPerson = async (user, { name }) => {
  try {
    const id = await withTransaction(async (client) => {
      await ensureSelf(client, user.uuid);
      const { rows } = await client.query(
        'insert into people (owner_id, name) values ($1, $2) returning id',
        [user.uuid, name]
      );
      return rows[0].id;
    });
    return toPerson(await loadPerson(user.uuid, id));
  } catch (error) {
    if (error.code === '23505') throw duplicateName(name);
    throw error;
  }
};

export const updatePerson = async (user, personId, { name, archived }) => {
  const current = await loadPerson(user.uuid, personId);
  if (archived === true && current.balance_paise !== 0) {
    throw new HttpError(409, `Settle up with ${current.name} before archiving them.`);
  }
  try {
    await query(
      `update people set
         name = coalesce($3, name),
         archived_at = case when $4::boolean is null then archived_at
                            when $4 then coalesce(archived_at, now())
                            else null end,
         updated_at = now()
       where owner_id = $1 and id = $2 and not is_self`,
      [user.uuid, personId, name ?? null, archived ?? null]
    );
  } catch (error) {
    if (error.code === '23505') throw duplicateName(name ?? current.name);
    throw error;
  }
  return toPerson(await loadPerson(user.uuid, personId));
};

// A person with their balance and everything that happened between you, newest first
export const getPerson = async (user, personId) => {
  const person = toPerson(await loadPerson(user.uuid, personId));

  const [expenses, settlements] = await Promise.all([
    query(
      `select e.id, e.kind, e.description, e.amount_paise, e.spent_on, e.category, e.created_at,
              e.my_share_expense_id is not null as added_to_expenses,
              coalesce((select sum(amount_paise) from expense_payers where expense_id = e.id and person_id = $2), 0) as their_paid,
              coalesce((select sum(amount_paise) from expense_shares where expense_id = e.id and person_id = $2), 0) as their_share
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

  // "Add my share to my expenses": a normal expense in Notion for your part of the bill.
  // Done after the ledger entry is saved; if Notion fails the entry stays and the response says so.
  let myShareAdded = false;
  if (input.type === 'split' && input.addMyShare && plan.myShare > 0) {
    try {
      const expense = await transactions.create(user, {
        expense: description,
        amount: toRupees(plan.myShare),
        category: input.category,
        paymentMethod: input.paymentMethod,
        date: input.date,
      });
      await query(
        'update shared_expenses set my_share_expense_id = $3, updated_at = now() where owner_id = $1 and id = $2',
        [user.uuid, entryId, expense.id]
      );
      myShareAdded = true;
    } catch (error) {
      console.error('Adding my share to expenses failed:', error);
    }
  }

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
  let myShareRemoved = null;
  if (rows[0].my_share_expense_id) {
    try {
      await transactions.remove(user, rows[0].my_share_expense_id);
      myShareRemoved = true;
    } catch (error) {
      console.error('Removing my share expense failed:', error);
      myShareRemoved = false;
    }
  }
  return { myShareRemoved };
};

// ── Settlements ─────────────────────────────────────────────────────────────

export const createSettlement = async (user, { personId, direction, amount, date, note }) => {
  await withTransaction(async (client) => {
    const selfId = await ensureSelf(client, user.uuid);
    await requireActivePerson(client, user.uuid, personId);
    const [from, to] = direction === 'they_paid' ? [personId, selfId] : [selfId, personId];
    await client.query(
      `insert into settlements (owner_id, from_person_id, to_person_id, amount_paise, paid_on, note)
       values ($1, $2, $3, $4, $5, $6)`,
      [user.uuid, from, to, toPaise(amount), date, note ?? null]
    );
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
