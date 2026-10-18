# Backpocket

Backpocket is a WhatsApp contact you share links, screenshots and reels to. It turns every save into a structured card (title, summary, key points, topics), stores it, and sends the right one back when you ask for it in the same chat.

Weekend 1 covers save and find. A calendar-matched morning brief comes next.

## Architecture

- **WhatsApp Cloud API** is the only interface. Meta calls `POST /api/whatsapp` for every incoming message.
- **Next.js route handler** on Vercel verifies the `X-Hub-Signature-256` signature, returns 200 right away, and does the work in `after()` so Meta never retries a slow webhook.
- **Extraction** (`lib/extract.ts`) reads Open Graph tags, page titles and JSON-LD recipes from links, and downloads screenshots. Pages that hide content behind a login are marked `needs_fallback` and the user is asked for a screenshot. No login scraping, no video downloads.
- **Claude** (`claude-sonnet-5-5`) turns the extracted content into a card using a strict tool schema, and picks the best matches when you search.
- **OpenAI** `text-embedding-3-small` embeds each card for semantic search.
- **Supabase** stores cards in Postgres with pgvector (`items`, `resurfacings`, `match_items()`), and screenshots in a private Storage bucket.

## Setup

1. Install Node 20 or newer, then run `npm install`.
2. Create a Supabase project. In the SQL editor, run `supabase/migrations/001_init.sql`.
3. In Supabase Storage, create a **private** bucket named `screenshots`.
4. Copy `.env.example` to `.env.local` and fill in every value. The app names any missing variable when it starts.
5. Run `npm run dev` and open http://localhost:3000/api/health. You should see `{"ok":true}`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server on port 3000 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run simulate` | Sends a signed fake WhatsApp webhook |

## Simulator

`scripts/simulate.ts` builds a realistic WhatsApp webhook payload, signs it with `WHATSAPP_APP_SECRET` from `.env.local`, and POSTs it to the webhook. It lets you test the full pipeline without a phone.

```bash
npm run simulate -- --text "https://www.example.com/some-article"
npm run simulate -- --text "what can I make with paneer?"
npm run simulate -- --text "hello" https://your-app.vercel.app/api/whatsapp
```

The URL defaults to `http://localhost:3000/api/whatsapp`. The sender is the first number in `ALLOWED_PHONES`.
