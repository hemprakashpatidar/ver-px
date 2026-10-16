-- Ledger: people you share money with, shared expenses and loans, and settlements.
--
-- Users still live in Notion; owner_id is the user's uuid from the login token, and
-- every row belongs to exactly one owner (each user's ledger is private).
--
-- Money is whole paise (bigint) so splits never drift through floating point.
-- The tables are shaped for groups too: group_id stays null for one-to-one entries,
-- and payers/shares can hold more than two people.

-- One row per contact, plus one row per owner that represents the owner ("me").
-- Having "me" as a real row keeps payers/shares uniform: every share points at a person.
create table people (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  is_self boolean not null default false,
  -- Reserved for later: the app user this contact is, if they ever share data
  linked_user_id text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create unique index people_one_self_per_owner on people (owner_id) where is_self;
-- No two active contacts with the same name (case-insensitive) for one owner
create unique index people_unique_active_name on people (owner_id, lower(btrim(name)))
  where archived_at is null and not is_self;
create index people_owner on people (owner_id);

-- A bill split between people, or a loan (one side paid, the other owes all of it)
create table shared_expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  group_id uuid,                      -- groups arrive in a later migration
  kind text not null check (kind in ('split', 'loan')),
  description text not null check (length(btrim(description)) between 1 and 200),
  amount_paise bigint not null check (amount_paise > 0),
  spent_on date not null,
  category text,
  -- Notion page created when "add my share to my expenses" was on
  my_share_expense_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create index shared_expenses_owner_date on shared_expenses (owner_id, spent_on desc);

-- Who paid. Composite foreign keys keep every row inside one owner's data.
create table expense_payers (
  owner_id text not null,
  expense_id uuid not null,
  person_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  primary key (expense_id, person_id),
  foreign key (owner_id, expense_id) references shared_expenses (owner_id, id) on delete cascade,
  foreign key (owner_id, person_id) references people (owner_id, id)
);

-- Who owes what (a share can be zero, e.g. "they paid it all for me")
create table expense_shares (
  owner_id text not null,
  expense_id uuid not null,
  person_id uuid not null,
  amount_paise bigint not null check (amount_paise >= 0),
  primary key (expense_id, person_id),
  foreign key (owner_id, expense_id) references shared_expenses (owner_id, id) on delete cascade,
  foreign key (owner_id, person_id) references people (owner_id, id)
);

create index expense_payers_person on expense_payers (person_id);
create index expense_shares_person on expense_shares (person_id);

-- Money handed over to settle up, fully or partly
create table settlements (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  group_id uuid,
  from_person_id uuid not null,
  to_person_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  paid_on date not null,
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  check (from_person_id <> to_person_id),
  foreign key (owner_id, from_person_id) references people (owner_id, id),
  foreign key (owner_id, to_person_id) references people (owner_id, id)
);

create index settlements_owner_date on settlements (owner_id, paid_on desc);
create index settlements_from on settlements (from_person_id);
create index settlements_to on settlements (to_person_id);
