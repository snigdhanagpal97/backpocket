-- Morning brief and job applications. Run once in the Supabase SQL editor.

-- Job and internship posts: what to look for in a confirmation email, and when it closes.
alter table items add column if not exists job_company text;
alter table items add column if not exists job_role text;
alter table items add column if not exists job_deadline date;

-- Who marked an item done: 'user' (replied with numbers) or 'email' (confirmation found).
alter table items add column if not exists done_source text;

-- So the brief doesn't nag about the same post every morning.
alter table items add column if not exists last_reminded_at timestamptz;

create index if not exists items_open_jobs_idx on items (user_phone, item_type) where done_at is null;

-- One brief per day, and a brief held back until the user next writes
-- (WhatsApp only allows free-form messages within 24 hours of their last one).
alter table chat_state add column if not exists last_brief_date date;
alter table chat_state add column if not exists pending_brief jsonb;
alter table chat_state add column if not exists pending_brief_at timestamptz;
