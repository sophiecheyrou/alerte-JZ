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
  exercise_id bigint references exercises(id),
  room_number text not null references rooms(room_number),
  status text not null check (status in ('PRESENT','SORTI','NON_LOCALISE')),
  station text,
  created_at timestamptz not null default now()
);

create or replace view current_room_status as
select distinct on (r.room_number)
  r.room_number,
  coalesce(e.status,'NON_LOCALISE') as status,
  e.station,
  e.created_at as updated_at
from rooms r
left join room_status_events e on e.room_number=r.room_number
where r.active=true
order by r.room_number,e.created_at desc nulls last,e.id desc;

alter table rooms enable row level security;
alter table room_status_events enable row level security;
create policy "read rooms" on rooms for select to anon using (true);
create policy "read events" on room_status_events for select to anon using (true);
create policy "insert events" on room_status_events for insert to anon with check (true);

alter publication supabase_realtime add table room_status_events;
