-- Derived memory only. Raw check logs, source chunks, and embeddings stay on the device.

create table if not exists public.concept_mastery (
  user_id uuid not null references auth.users (id) on delete cascade,
  concept text not null,
  mastery double precision not null,
  elo double precision not null default 1000,
  attempts integer not null default 0,
  last_seen timestamptz not null,
  primary key (user_id, concept)
);

create table if not exists public.recall_cards (
  user_id uuid not null references auth.users (id) on delete cascade,
  concept text not null,
  ease double precision not null,
  interval_days integer not null,
  repetitions integer not null,
  due_at timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  last_review timestamptz,
  primary key (user_id, concept)
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  exam_date date,
  interview_date date,
  preferred_language text,
  strictness text,
  updated_at timestamptz not null default now()
);

create table if not exists public.file_knowledge (
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null,
  concepts text[] not null default '{}',
  passed boolean not null default false,
  ai_written boolean not null default false,
  core boolean not null default false,
  complexity double precision,
  centrality double precision,
  updated_at timestamptz not null,
  primary key (user_id, path)
);

-- One row per quiz or login review. Includes the question and the student's answer. No source code.
create table if not exists public.review_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  concepts text[] not null default '{}',
  event_kind text not null check (event_kind in ('check', 'recall', 'bypass', 'explain')),
  source text,
  mode text,
  score double precision,
  passed boolean,
  followups integer not null default 0,
  mastery_after double precision,
  file_path text,
  question text,
  student_answer text,
  misconception text,
  asked_for_explanation boolean not null default false,
  explanation text,
  judge_config_id text
);

alter table public.concept_mastery enable row level security;
alter table public.recall_cards enable row level security;
alter table public.profiles enable row level security;
alter table public.file_knowledge enable row level security;
alter table public.review_events enable row level security;

create policy "own mastery" on public.concept_mastery
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own cards" on public.recall_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own files" on public.file_knowledge
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own events" on public.review_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists review_events_user_time
  on public.review_events (user_id, occurred_at);
