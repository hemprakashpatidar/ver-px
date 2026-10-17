-- Groups (like Splitwise): shared expenses and settlements among several people.
--
-- Groups don't belong to a ledger: members can come from any of your ledgers. Your own
-- "self" person row is always a member. Rows stay private to their owner, as before.

create table groups (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null check (length(btrim(name)) between 1 and 60),
  emoji text check (emoji is null or length(emoji) <= 16),
  -- Off: who owes whom follows each expense ("you paid, so they owe you").
  -- On: balances are rearranged into the fewest payments.
  simplify_debts boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create index groups_owner on groups (owner_id);

create table group_members (
  owner_id text not null,
  group_id uuid not null,
  person_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, person_id),
  foreign key (owner_id, group_id) references groups (owner_id, id) on delete cascade,
  foreign key (owner_id, person_id) references people (owner_id, id)
);

create index group_members_person on group_members (person_id);

-- group_id was reserved in 001; now it points at a real group of the same owner
alter table shared_expenses
  add constraint shared_expenses_group_fk
    foreign key (owner_id, group_id) references groups (owner_id, id) on delete cascade;
alter table settlements
  add constraint settlements_group_fk
    foreign key (owner_id, group_id) references groups (owner_id, id) on delete cascade;

create index shared_expenses_group on shared_expenses (group_id) where group_id is not null;
create index settlements_group on settlements (group_id) where group_id is not null;

-- How a group expense was split, and what was typed for each person (a percentage or a
-- share count), so the split can be shown and edited later. Amounts stay authoritative.
alter table shared_expenses
  add column split_type text check (split_type in ('equal', 'exact', 'percent', 'shares'));
alter table expense_shares
  add column weight numeric(12, 4) check (weight is null or weight >= 0);
