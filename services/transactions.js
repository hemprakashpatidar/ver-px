import { queryDatabase, getPage, createPage, updatePage, NotionError } from '../lib/notion.js';
import { HttpError } from '../lib/errors.js';

// Owner rows live in their own databases; everyone else shares TXN_DATABASE_ID
const sourcesFor = ({ isMe }) => {
  const { MY_DATABASE_ID, MY_DATABASE_ID_CC, TXN_DATABASE_ID } = process.env;
  return isMe
    ? [{ source: 'default', databaseId: MY_DATABASE_ID }, { source: 'cc', databaseId: MY_DATABASE_ID_CC }]
    : [{ source: 'default', databaseId: TXN_DATABASE_ID }];
};

// New transactions always go to the default database (adding to the CC database is not supported yet)
const writeDatabaseFor = (user) => sourcesFor(user)[0].databaseId;

const monthRange = (month, year) => {
  const pad = (n) => String(n).padStart(2, '0');
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return { startDate: `${year}-${pad(month)}-01`, endDate: `${nextYear}-${pad(nextMonth)}-01` };
};

const toTransaction = (page, source) => {
  const p = page.properties;
  return {
    id: page.id,
    expense: p.Expense?.title?.[0]?.plain_text || '',
    amount: p.Amount?.number ?? 0,
    date: p.Date?.date?.start || null,
    category: p.Category?.select?.name || 'Other',
    paymentMethod: p['Payment Method']?.select?.name || 'Other',
    source
  };
};

const toProperties = ({ expense, amount, category, paymentMethod, date }) => {
  const properties = {};
  if (expense !== undefined) properties['Expense'] = { title: [{ text: { content: expense } }] };
  if (amount !== undefined) properties['Amount'] = { number: amount };
  if (category !== undefined) properties['Category'] = { select: { name: category } };
  if (paymentMethod !== undefined) properties['Payment Method'] = { select: { name: paymentMethod } };
  if (date !== undefined) properties['Date'] = { date: { start: date } };
  return properties;
};

export const listForMonth = async (user, { month, year }) => {
  const { startDate, endDate } = monthRange(month, year);
  const filter = {
    and: [
      { property: 'uuid', rich_text: { equals: user.uuid } },
      { property: 'userName', title: { equals: user.userName } },
      { property: 'Date', date: { on_or_after: startDate } },
      { property: 'Date', date: { before: endDate } }
    ]
  };
  const sorts = [{ property: 'Date', direction: 'descending' }];

  const sources = sourcesFor(user);
  const settled = await Promise.allSettled(
    sources.map(({ databaseId }) => queryDatabase(databaseId, { filter, sorts }))
  );

  return settled.flatMap((result, i) => {
    const { source } = sources[i];
    if (result.status === 'fulfilled') {
      return result.value.map(page => toTransaction(page, source));
    }
    // The default database is required; the CC database is best-effort, as before
    if (source === 'default') throw result.reason;
    console.error(`Skipping ${source} transactions:`, result.reason);
    return [];
  });
};

// Not-found and not-owned both return 404 so ids of other users' rows are not confirmed
const getOwnedPage = async (user, id) => {
  let page;
  try {
    page = await getPage(id);
  } catch (error) {
    if (error instanceof NotionError && [400, 404].includes(error.status)) {
      throw new HttpError(404, 'Transaction not found');
    }
    throw error;
  }

  const pageUuid = page.properties?.uuid?.rich_text?.[0]?.plain_text;
  const pageUserName = page.properties?.userName?.rich_text?.[0]?.plain_text;
  if (page.archived || pageUuid !== user.uuid || pageUserName !== user.userName) {
    throw new HttpError(404, 'Transaction not found');
  }
  return page;
};

const sourceOf = (user, page) => {
  const parentId = page.parent?.database_id?.replace(/-/g, '');
  const match = sourcesFor(user).find(({ databaseId }) => databaseId?.replace(/-/g, '') === parentId);
  return match?.source || 'default';
};

export const create = async (user, input) => {
  const page = await createPage(writeDatabaseFor(user), {
    ...toProperties(input),
    uuid: { rich_text: [{ text: { content: user.uuid } }] },
    userName: { rich_text: [{ text: { content: user.userName } }] }
  });
  return toTransaction(page, 'default');
};

export const update = async (user, id, changes) => {
  const page = await getOwnedPage(user, id);
  const updated = await updatePage(id, { properties: toProperties(changes) });
  return toTransaction(updated, sourceOf(user, page));
};

export const remove = async (user, id) => {
  await getOwnedPage(user, id);
  await updatePage(id, { archived: true });
};
