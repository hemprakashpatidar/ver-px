import { query, withTransaction } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { toRupees } from '../lib/money.js';
import { newToken, hashToken, encryptToken, decryptToken } from '../lib/shareTokens.js';
import { loadGroups } from './groupData.js';

const requireOwnGroup = async (db, ownerId, groupId) => {
  const { rows } = await db.query('select id from groups where owner_id = $1 and id = $2', [ownerId, groupId]);
  if (!rows[0]) throw new HttpError(404, 'Group not found');
};

const toLink = (row) => {
  if (!row) return { active: false };
  const token = decryptToken(row.token_encrypted);
  // An unreadable token still works for viewers; the owner just can't copy it any more
  return { active: true, token, createdAt: row.created_at, needsNewLink: token === null };
};

// ── Owner: manage the link ──────────────────────────────────────────────────

export const getShareLink = async (user, groupId) => {
  await requireOwnGroup({ query }, user.uuid, groupId);
  const { rows } = await query(
    'select token_encrypted, created_at from group_share_links where owner_id = $1 and group_id = $2 and revoked_at is null',
    [user.uuid, groupId]
  );
  return toLink(rows[0]);
};

// Makes a new link; any previous one stops working
export const createShareLink = async (user, groupId) => {
  const token = newToken();
  const row = await withTransaction(async (client) => {
    await requireOwnGroup(client, user.uuid, groupId);
    await client.query(
      'update group_share_links set revoked_at = now() where owner_id = $1 and group_id = $2 and revoked_at is null',
      [user.uuid, groupId]
    );
    const { rows } = await client.query(
      `insert into group_share_links (owner_id, group_id, token_hash, token_encrypted, owner_name)
       values ($1, $2, $3, $4, $5) returning created_at`,
      [user.uuid, groupId, hashToken(token), encryptToken(token), user.userName]
    );
    return rows[0];
  });
  return { active: true, token, createdAt: row.created_at, needsNewLink: false };
};

export const revokeShareLink = async (user, groupId) => {
  await requireOwnGroup({ query }, user.uuid, groupId);
  await query(
    'update group_share_links set revoked_at = now() where owner_id = $1 and group_id = $2 and revoked_at is null',
    [user.uuid, groupId]
  );
  return { active: false };
};

// ── Viewer: the read-only group ─────────────────────────────────────────────

// What anyone with the link sees. Only names and amounts: no internal ids, ledgers, or
// whether the owner copied a share into their own expenses.
export const getSharedGroup = async (token) => {
  const { rows } = await query(
    `select l.owner_id, l.group_id, l.owner_name
     from group_share_links l
     where l.token_hash = $1 and l.revoked_at is null`,
    [hashToken(token)]
  );
  const link = rows[0];
  if (!link) throw new HttpError(404, 'This link isn\'t active any more. Ask for a new one.');

  const [data] = await loadGroups(link.owner_id, { groupIds: [link.group_id] });
  if (!data) throw new HttpError(404, 'This link isn\'t active any more. Ask for a new one.');

  // Opaque per-response ids instead of database ids
  const publicId = new Map(data.members.map((m, i) => [m.id, `m${i + 1}`]));
  const idOf = (personId) => publicId.get(personId) ?? 'unknown';

  return {
    sharedBy: link.owner_name,
    group: {
      name: data.group.name,
      emoji: data.group.emoji,
      simplifyDebts: data.group.simplifyDebts,
      archived: data.group.archived,
      memberCount: data.members.length,
      totalSpent: toRupees(data.expenses.reduce((sum, e) => sum + e.amount_paise, 0)),
    },
    members: data.members.map(m => ({
      id: idOf(m.id),
      name: m.is_self ? link.owner_name : m.name,
      net: toRupees(data.nets.get(m.id) || 0),
    })),
    debts: data.debts.map(d => ({ from: idOf(d.from), to: idOf(d.to), amount: toRupees(d.paise) })),
    activity: [
      ...data.expenses.map((e, i) => ({
        type: 'expense',
        id: `e${i + 1}`,
        description: e.description,
        amount: toRupees(e.amount_paise),
        date: e.spent_on,
        splitType: e.split_type,
        paidBy: e.payers.map(p => ({ memberId: idOf(p.personId), amount: toRupees(p.paise) })),
        shares: e.shares.filter(s => s.paise > 0).map(s => ({ memberId: idOf(s.personId), amount: toRupees(s.paise) })),
        createdAt: e.created_at,
      })),
      ...data.settlements.map((s, i) => ({
        type: 'settlement',
        id: `s${i + 1}`,
        from: idOf(s.from),
        to: idOf(s.to),
        amount: toRupees(s.paise),
        date: s.paid_on,
        note: s.note,
        createdAt: s.created_at,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date) || new Date(b.createdAt) - new Date(a.createdAt))
      // createdAt only orders same-day items; viewers don't need it
      .map(({ createdAt: _createdAt, ...item }) => item),
  };
};
