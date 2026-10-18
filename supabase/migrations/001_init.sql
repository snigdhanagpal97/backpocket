-- Backpocket schema, Weekend 1.
-- Run this once in the Supabase SQL editor.

create extension if not exists vector;

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null,
  source text not null,
  url text,
  raw_text text,
  image_path text,
  item_type text,
  title text,
  summary text,
  key_points jsonb default '[]',
  entities jsonb default '{}',
  topics text[] default '{}',
  embedding vector(1536),
  status text default 'complete',
  wa_message_id text unique,
  created_at timestamptz default now(),
  last_opened_at timestamptz
);

create table if not exists resurfacings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references items(id) on delete cascade,
  trigger text,
  sent_at timestamptz default now(),
  feedback text
);

create index if not exists items_user_phone_idx on items (user_phone);
create index if not exists items_created_at_idx on items (created_at);

-- The app talks to Postgres with the service role key, which bypasses RLS.
-- Turning RLS on with no policies keeps these tables closed to the public anon key.
alter table items enable row level security;
alter table resurfacings enable row level security;

create or replace function match_items(
  query_embedding vector(1536),
  match_count int,
  phone text
)
returns table (
  id uuid,
  title text,
  summary text,
  url text,
  item_type text,
  similarity float
)
language sql stable
as $$
  select
    items.id,
    items.title,
    items.summary,
    items.url,
    items.item_type,
    1 - (items.embedding <=> query_embedding) as similarity
  from items
  where items.user_phone = phone
    and items.embedding is not null
  order by items.embedding <=> query_embedding
  limit match_count;
$$;
