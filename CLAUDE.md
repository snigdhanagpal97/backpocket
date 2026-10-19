# Backpocket

Backpocket is a WhatsApp contact that people share links, screenshots and reels to. It turns every save into a structured card, stores it, and sends the right item back when it's needed: when the user asks, or in a 7am brief matched to their calendar.

Quality bar: clear structure, tested pure functions, and honest handling of platform limits matter as much as features.

## Stack

- Next.js (App Router, TypeScript, strict mode) deployed on Vercel
- WhatsApp Cloud API (Meta test number) as the only user interface
- Claude API via `@anthropic-ai/sdk`, model `claude-sonnet-5-5`, for card building and search answers
- OpenAI `text-embedding-3-small` (1536 dims) for embeddings
- Supabase Postgres + pgvector + Storage (`@supabase/supabase-js`, service role key, server only)
- `zod` for all external data and model output, `cheerio` for HTML parsing, `vitest` for tests

## Folder layout

```
app/api/whatsapp/route.ts   webhook (GET verify, POST receive)
app/api/health/route.ts     health check
lib/whatsapp.ts             sendText, downloadMedia, Graph API version constant
lib/verify-signature.ts     X-Hub-Signature-256 check
lib/handle-message.ts       routes each incoming message
lib/extract.ts              link, image and text extraction
lib/card.ts                 Claude card builder
lib/embed.ts                OpenAI embeddings
lib/search.ts               semantic search + Claude answer
lib/db.ts                   Supabase client and typed queries
lib/types.ts                shared types and zod schemas
supabase/migrations/        SQL migrations (user runs them in the Supabase SQL editor)
scripts/simulate.ts         sends a signed fake webhook payload to a local or deployed URL
tests/                      vitest tests
```

## Environment variables

```
WHATSAPP_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_VERIFY_TOKEN
WHATSAPP_APP_SECRET
ALLOWED_PHONES            comma separated, digits only
ANTHROPIC_API_KEY
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Validate them at startup with zod in `lib/env.ts` and fail with a clear message naming the missing variable. Keep `.env.example` in sync. Never commit `.env.local`.

## Rules

- The webhook returns 200 immediately and does the work in `after()` from `next/server`. Meta retries slow webhooks, so dedupe on the WhatsApp message id (`items.wa_message_id`).
- Verify `X-Hub-Signature-256` on every POST before parsing.
- Only process messages from numbers in `ALLOWED_PHONES`.
- Never download Instagram or LinkedIn video, never scrape behind a login, never read personal WhatsApp chats. When a page hides its content, mark the item `needs_fallback` and ask the user for a screenshot. This is a deliberate product decision.
- Claude must only use content it was given. The card prompt says so explicitly.
- Every model response is parsed with zod. On a parse failure, retry once, then reply with a friendly error.
- Every user-facing failure gets a WhatsApp reply ("Couldn't save that one, try again?") and a logged error with context.
- Keep WhatsApp replies short (under 700 characters) and plain text.
- Pure functions (URL detection, source classification, HTML parsing, signature checks) live apart from network code and have tests.

## Done means

`npm run lint`, `npm run build` and `npm test` all pass, and the change has been tested with `scripts/simulate.ts` or a real WhatsApp message.

## Roadmap

1. Weekend 1: save and find (webhook, extraction, cards, search in chat)
2. Weekend 2: Google Calendar, 7am brief via Vercel Cron, thumbs up/down feedback, Notability PDFs from a Google Drive folder
3. Weekend 3: web gallery, evals on 50 hand-labeled items, beta users, graveyard rate tracking
