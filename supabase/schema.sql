-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run

create table if not exists public.schedule_docs (
  id          text primary key,           -- 'p_<personId>' or 'teach'
  kind        text not null,              -- 'person' | 'teach'
  sort        double precision not null default 0,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.schedule_docs enable row level security;
alter table public.schedule_docs replica identity full;

-- Anyone with the website link can read and edit (shared class sheet, no login).
drop policy if exists "schedule read"   on public.schedule_docs;
drop policy if exists "schedule insert" on public.schedule_docs;
drop policy if exists "schedule update" on public.schedule_docs;
drop policy if exists "schedule delete" on public.schedule_docs;
create policy "schedule read"   on public.schedule_docs for select to anon, authenticated using (true);
create policy "schedule insert" on public.schedule_docs for insert to anon, authenticated with check (true);
create policy "schedule update" on public.schedule_docs for update to anon, authenticated using (true) with check (true);
create policy "schedule delete" on public.schedule_docs for delete to anon, authenticated using (true);

-- Turn on realtime for this table.
do $$ begin
  alter publication supabase_realtime add table public.schedule_docs;
exception when duplicate_object then null; end $$;
