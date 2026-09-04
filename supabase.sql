create table if not exists rooms (
  room_number text primary key,
  floor integer check (floor between 1 and 5),
  side text check (side in ('PAIR','IMPAIR')),
  courtyard text,
  active boolean not null default true
);

create table if not exists exercises (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  is_active boolean not null default true
);

create table if not exists room_status_events (
  id bigint generated always as identity primary key,
  exercise_id bigint not null references exercises(id) on delete cascade,
  room_number text not null references rooms(room_number),
  status text not null check (status in ('PRESENT','SORTI','NON_LOCALISE')),
  station text,
  created_at timestamptz not null default now()
);

create table if not exists exercise_archives (
  id bigint generated always as identity primary key,
  exercise_id bigint references exercises(id) on delete set null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create or replace view current_room_status as
select distinct on (e.exercise_id,r.room_number)
  e.exercise_id,
  r.room_number,
  coalesce(ev.status,'NON_LOCALISE') as status,
  ev.station,
  ev.created_at as updated_at
from exercises e
cross join rooms r
left join room_status_events ev on ev.exercise_id=e.id and ev.room_number=r.room_number
where r.active=true
order by e.exercise_id,r.room_number,ev.created_at desc nulls last,ev.id desc;

alter table rooms enable row level security;
alter table exercises enable row level security;
alter table room_status_events enable row level security;
alter table exercise_archives enable row level security;

drop policy if exists "read rooms" on rooms;
drop policy if exists "read exercises" on exercises;
drop policy if exists "insert exercises" on exercises;
drop policy if exists "update exercises" on exercises;
drop policy if exists "read events" on room_status_events;
drop policy if exists "insert events" on room_status_events;
drop policy if exists "read archives" on exercise_archives;
drop policy if exists "insert archives" on exercise_archives;

create policy "read rooms" on rooms for select to anon using (true);
create policy "read exercises" on exercises for select to anon using (true);
create policy "insert exercises" on exercises for insert to anon with check (true);
create policy "update exercises" on exercises for update to anon using (true) with check (true);
create policy "read events" on room_status_events for select to anon using (true);
create policy "insert events" on room_status_events for insert to anon with check (true);
create policy "read archives" on exercise_archives for select to anon using (true);
create policy "insert archives" on exercise_archives for insert to anon with check (true);

do $$ begin
  alter publication supabase_realtime add table room_status_events;
exception when duplicate_object then null;
end $$;
