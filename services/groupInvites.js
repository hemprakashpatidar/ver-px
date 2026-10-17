import { query, withTransaction } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { toRupees } from '../lib/money.js';
import { newToken, hashToken, encryptToken, decryptToken, memberRef } from '../lib/shareTokens.js';
import { loadGroups } from './groupData.js';
import { buildGroupView } from './groupShares.js';

const PURPOSE = 'group-invites';
const INVITE_DAYS = 14;
const GONE = 'This invite isn\'t active any more. Ask for a new link.';

const requireOwnGroup = async (db, ownerId, groupId) => {
  const { rows } = await db.query('select id from groups where owner_id = $1 and id = $2', [ownerId, groupId]);
  if (!rows[0]) throw new HttpError(404, 'Group not found');
};

const toInvite = (row) => {
  if (!row) return { active: false };
  const expired = new Date(row.expires_at) <= new Date();
  const token = decryptToken(row.token_encrypted, PURPOSE);
  return { active: !expired, expired, token, expiresAt: row.expires_at, needsNewLink: token === null };
};

// ── Owner ───────────────────────────────────────────────────────────────────

// The invite link plus who has claimed which member
export const getInvites = async (user, groupId) => {
  await requireOwnGroup({ query }, user.uuid, groupId);
  const [invite, members] = await Promise.all([
    query(
      'select token_encrypted, expires_at from group_invites where owner_id = $1 and group_id = $2 and revoked_at is null',
      [user.uuid, groupId]
    ),
    query(
      `select p.id, p.name, p.is_self, a.user_name, a.granted_at
       from group_members m
       join people p on p.id = m.person_id
       left join group_access a on a.group_id = m.group_id and a.person_id = m.person_id
       where m.owner_id = $1 and m.group_id = $2
       order by p.is_self desc, m.joined_at, p.name`,
      [user.uuid, groupId]
    ),
  ]);
  return {
    invite: toInvite(invite.rows[0]),
    members: members.rows.filter(m => !m.is_self).map(m => ({
      personId: m.id,
      name: m.name,
      claimedBy: m.user_name ? { userName: m.user_name, joinedAt: m.granted_at } : null,
    })),
  };
};

// A fresh 14-day link; the old one stops working, people who already joined keep access
export const createInvite = async (user, groupId) => {
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  await withTransaction(async (client) => {
    await requireOwnGroup(client, user.uuid, groupId);
    await client.query(
      'update group_invites set revoked_at = now() where owner_id = $1 and group_id = $2 and revoked_at is null',
      [user.uuid, groupId]
    );
    await client.query(
      `insert into group_invites (owner_id, group_id, token_hash, token_encrypted, owner_name, expires_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [user.uuid, groupId, hashToken(token), encryptToken(token, PURPOSE), user.userName, expiresAt]
    );
  });
  return { active: true, expired: false, token, expiresAt, needsNewLink: false };
};

export const revokeInvite = async (user, groupId) => {
  await requireOwnGroup({ query }, user.uuid, groupId);
  await query(
    'update group_invites set revoked_at = now() where owner_id = $1 and group_id = $2 and revoked_at is null',
    [user.uuid, groupId]
  );
  return { active: false };
};

export const removeAccess = async (user, groupId, personId) => {
  const { rowCount } = await query(
    'delete from group_access where owner_id = $1 and group_id = $2 and person_id = $3',
    [user.uuid, groupId, personId]
  );
  if (rowCount === 0) throw new HttpError(404, 'Nobody has joined as that member.');
};

// ── Invitee ─────────────────────────────────────────────────────────────────

const loadActiveInvite = async (db, token) => {
  const { rows } = await db.query(
    `select i.owner_id, i.group_id, i.owner_name, i.expires_at, g.name, g.emoji
     from group_invites i join groups g on g.id = i.group_id
     where i.token_hash = $1 and i.revoked_at is null and i.expires_at > now()`,
    [hashToken(token)]
  );
  if (!rows[0]) throw new HttpError(404, GONE);
  return rows[0];
};

const claimableMembers = async (db, invite) => {
  const { rows } = await db.query(
    `select p.id, p.name, a.user_id
     from group_members m
     join people p on p.id = m.person_id
     left join group_access a on a.group_id = m.group_id and a.person_id = m.person_id
     where m.owner_id = $1 and m.group_id = $2 and not p.is_self
     order by m.joined_at, p.name`,
    [invite.owner_id, invite.group_id]
  );
  return rows;
};

// Public: enough to say who's inviting you to what, and which names are still free.
// Member codes come from memberRef(), never database ids.
export const previewInvite = async (token) => {
  const invite = await loadActiveInvite({ query }, token);
  const members = await claimableMembers({ query }, invite);
  return {
    groupName: invite.name,
    emoji: invite.emoji,
    invitedBy: invite.owner_name,
    expiresAt: invite.expires_at,
    members: members.map(m => ({ ref: memberRef(token, m.id), name: m.name, claimed: m.user_id !== null })),
  };
};

export const claimInvite = async (user, token, { memberRef: ref }) => {
  const groupId = await withTransaction(async (client) => {
    const invite = await loadActiveInvite(client, token);
    if (invite.owner_id === user.uuid) throw new HttpError(409, 'This is your own group, so you already have it.');

    const members = await claimableMembers(client, invite);
    const member = members.find(m => memberRef(token, m.id) === ref);
    if (!member) throw new HttpError(404, 'That name isn\'t in this group any more.');
    if (member.user_id === user.uuid) return invite.group_id; // already yours: nothing to do
    if (member.user_id) throw new HttpError(409, `Someone has already joined as ${member.name}.`);
    if (members.some(m => m.user_id === user.uuid)) {
      throw new HttpError(409, 'You\'ve already joined this group as someone else.');
    }

    try {
      await client.query(
        `insert into group_access (owner_id, group_id, person_id, user_id, user_name, owner_name)
         values ($1, $2, $3, $4, $5, $6)`,
        [invite.owner_id, invite.group_id, member.id, user.uuid, user.userName, invite.owner_name]
      );
    } catch (error) {
      // Lost a race with someone claiming at the same moment
      if (error.code === '23505') throw new HttpError(409, `Someone has already joined as ${member.name}.`);
      throw error;
    }
    return invite.group_id;
  });
  return { groupId };
};

// ── Shared with you ─────────────────────────────────────────────────────────

const accessFor = async (userId, groupId) => {
  const { rows } = await query(
    `select a.owner_id, a.group_id, a.person_id, a.owner_name, p.name as member_name
     from group_access a join people p on p.id = a.person_id
     where a.user_id = $1 ${groupId ? 'and a.group_id = $2' : ''}
     order by a.granted_at`,
    groupId ? [userId, groupId] : [userId]
  );
  return rows;
};

export const listSharedWithMe = async (user) => {
  const access = await accessFor(user.uuid);
  const summaries = await Promise.all(access.map(async (a) => {
    const [data] = await loadGroups(a.owner_id, { groupIds: [a.group_id] });
    if (!data) return null;
    const dates = [...data.expenses.map(e => e.spent_on), ...data.settlements.map(s => s.paid_on)].sort();
    return {
      id: a.group_id,
      name: data.group.name,
      emoji: data.group.emoji,
      archived: data.group.archived,
      sharedBy: a.owner_name,
      joinedAs: a.member_name,
      memberCount: data.members.length,
      totalSpent: toRupees(data.expenses.reduce((sum, e) => sum + e.amount_paise, 0)),
      myNet: toRupees(data.nets.get(a.person_id) || 0),
      lastActivityOn: dates[dates.length - 1] ?? null,
    };
  }));
  return summaries.filter(Boolean);
};

export const getSharedWithMe = async (user, groupId) => {
  const [access] = await accessFor(user.uuid, groupId);
  if (!access) throw new HttpError(404, 'Group not found');
  const [data] = await loadGroups(access.owner_id, { groupIds: [groupId] });
  if (!data) throw new HttpError(404, 'Group not found');
  return {
    sharedBy: access.owner_name,
    joinedAs: access.member_name,
    ...buildGroupView(data, { ownerName: access.owner_name, viewerPersonId: access.person_id }),
  };
};

export const leaveSharedGroup = async (user, groupId) => {
  const { rowCount } = await query('delete from group_access where user_id = $1 and group_id = $2', [user.uuid, groupId]);
  if (rowCount === 0) throw new HttpError(404, 'Group not found');
};
