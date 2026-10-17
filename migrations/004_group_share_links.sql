-- Read-only share links for groups: anyone with the link can view the group without logging in.
--
-- The token itself is never stored in plain text:
--   token_hash       sha256 of the token, used to look the link up
--   token_encrypted  AES-256-GCM copy (key derived from JWT_SECRET) so the owner can copy it again
-- A copy of the database alone therefore can't open anyone's links.

create table group_share_links (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  group_id uuid not null,
  token_hash text not null unique,
  token_encrypted text not null,
  -- Shown to viewers in place of "You"
  owner_name text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (owner_id, group_id) references groups (owner_id, id) on delete cascade
);

-- At most one working link per group; making a new one revokes the old
create unique index group_share_links_one_active on group_share_links (group_id) where revoked_at is null;
