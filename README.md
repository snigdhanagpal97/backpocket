# Backpocket

Backpocket is a WhatsApp contact you share links, screenshots and reels to. It turns every save into a structured card (title, summary, key points, topics), stores it, and sends the right one back when you ask for it in the same chat.

## Why I built it

I save things by sending them to my own WhatsApp chat: LinkedIn posts before coffee chats, recipes, how-to reels, internship postings. I almost never open them again, and when I need one I can't find it. The problem isn't reading. It's timing: a saved post is useful on the morning of the chat it relates to, not the day I saved it.

So Backpocket lives where the saving habit already is. You share to it like any contact, ask it questions in plain language, and tell it what you acted on ("applied to 1 and 3").

## What works today

- **Save:** links (LinkedIn, recipe sites, articles), screenshots and plain notes become searchable cards.
- **Find:** "what did Aditi say about growth cases?" gets a short answer that quotes the original message you saved.
- **Lists:** "share all summer 2027 internship links" returns a numbered list; reply with numbers to mark them applied, cooked or read, and they drop out of future lists.

Not built yet: the calendar-matched morning brief (in progress) and Notability notes.

## Product decisions

| Decision | Alternative I rejected | Why |
| --- | --- | --- |
| WhatsApp as the only interface | Telegram bot, web app | It's where I already save things. Telegram was an hour less setup but a habit I don't have. |
| Ask for a screenshot when LinkedIn or Instagram hides a post | Scraping behind logins, downloading reels | Scraping breaks the platforms' terms and fails silently. A screenshot works every time and the user knows why it's asked. |
| Claude decides what a link-free message means, with a keyword check as backup | Keyword rules only | "Done with Nordstrom" or just "2" only makes sense next to the last list sent, which keyword rules can't see. The backup keeps the bot answering when the model call fails. |
| Answers capped near 200 characters | Full summaries | Early answers restated everything in the saved item. A reply should read like a friend who read it for you. |
| Strip tracking parameters before saving links | Store links as shared | The same LinkedIn post shared twice had different URLs, so duplicates slipped through. |

## How I built it

I wrote the spec and the rules in [CLAUDE.md](CLAUDE.md) and built with Claude Code. Every change after the first version came from using it on my own saves: two screenshots racing for one link, LinkedIn previews cutting posts short, answers running too long. The commit history shows that trail.

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

Against a server with a real `WHATSAPP_TOKEN` (including the deployed app), every simulated message gets a real WhatsApp reply on that phone, and test items mix with real ones. To test without sending anything, run the local server with a fake token: `WHATSAPP_TOKEN=fake npm run dev`.
