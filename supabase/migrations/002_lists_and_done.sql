-- Lists and "I applied to these". Run once in the Supabase SQL editor.

-- When the user said they acted on an item ("applied", "cooked", "read").
alter table items add column if not exists done_at timestamptz;
alter table items add column if not exists done_label text;

-- The last numbered list sent to each user, so "1, 3" can be resolved.
create table if not exists chat_state (
  user_phone text primary key,
  last_list jsonb not null default '[]',
  last_list_at timestamptz,
  updated_at timestamptz default now()
);

alter table chat_state enable row level security;
