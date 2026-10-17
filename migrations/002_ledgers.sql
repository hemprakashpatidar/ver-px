-- Multiple ledgers ("separate books") per user, e.g. Personal, Business, Home.
--
-- Every contact belongs to exactly one ledger. Entries and settlements don't need a
-- ledger column: they are always between you and one contact, so they live in that
-- contact's ledger. The "self" row stays per owner and has no ledger.

create table ledgers (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null check (length(btrim(name)) between 1 and 60),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create unique index ledgers_unique_active_name on ledgers (owner_id, lower(btrim(name)))
  where archived_at is null;
create index ledgers_owner on ledgers (owner_id);

-- Existing data moves into a "Personal" ledger, one per owner who has contacts
insert into ledgers (owner_id, name)
select distinct owner_id, 'Personal' from people where not is_self;

alter table people add column ledger_id uuid;

update people p
set ledger_id = l.id
from ledgers l
where l.owner_id = p.owner_id and not p.is_self;

alter table people
  add constraint people_ledger_matches_kind
    check ((is_self and ledger_id is null) or (not is_self and ledger_id is not null)),
  add constraint people_ledger_fk
    foreign key (owner_id, ledger_id) references ledgers (owner_id, id);

-- Names are unique within a ledger now: "Rahul" can exist in Personal and in Business
drop index people_unique_active_name;
create unique index people_unique_active_name on people (ledger_id, lower(btrim(name)))
  where archived_at is null and not is_self;
create index people_ledger on people (ledger_id);
