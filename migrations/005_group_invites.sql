-- Invite members to log in and see a group (read-only, from their own point of view).
--
-- One invite link per group, valid 14 days, usable by several people: each person claims
-- which member they are. A member can be claimed once, and an account can be only one
-- member of a group. The group stays owned by its creator; group_access only grants reading.

create table group_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  group_id uuid not null,
  token_hash text not null unique,
  token_encrypted text not null,
  owner_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (owner_id, group_id) references groups (owner_id, id) on delete cascade
);

create unique index group_invites_one_active on group_invites (group_id) where revoked_at is null;

create table group_access (
  owner_id text not null,
  group_id uuid not null,
  person_id uuid not null,
  user_id text not null,          -- the invited member's own login uuid
  user_name text not null,
  owner_name text not null,       -- shown to them in place of the owner's "You"
  granted_at timestamptz not null default now(),
  primary key (group_id, person_id),
  unique (group_id, user_id),
  foreign key (owner_id, group_id) references groups (owner_id, id) on delete cascade,
  foreign key (group_id, person_id) references group_members (group_id, person_id) on delete cascade
);

create index group_access_user on group_access (user_id);
