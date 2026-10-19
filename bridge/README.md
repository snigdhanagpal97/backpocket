# Morning brief bridge

A small Google Apps Script that runs in your own Google account between 6 and 7am. It reads today's Google Calendar events and the last 3 days of emails that look like job-application confirmations, and sends only those to Backpocket. Backpocket then sends you one WhatsApp message:

- applications it found in your email, which it marks applied,
- what to read before today's meetings, from things you saved,
- job posts you saved but haven't applied to, numbered so you can reply "1, 3" or "skip 2".

Quiet days get no message.

**Why a script instead of "Sign in with Google":** Google treats inbox access as restricted. An OAuth app needs a paid security assessment, and until it has one its login expires every 7 days. A script in your own account avoids both, and your inbox never leaves Google. Emails are sent as sender, subject, date and Gmail's one-line snippet, and Backpocket doesn't store them. The catch is that each beta user installs their own copy.

## 1. Server

1. In Supabase's SQL editor, run `supabase/migrations/003_brief_and_jobs.sql`.
2. Generate a secret with `openssl rand -hex 32` and set it as `BRIDGE_SECRET` in Vercel (and `.env.local`). Redeploy.
3. Find the job posts you saved before this existed: `npm run backfill-jobs -- https://your-app.vercel.app`.

## 2. The script

1. Go to [script.google.com](https://script.google.com) signed in to your **personal** Google account and create a new project named "Backpocket bridge".
2. Project Settings: tick **Show "appsscript.json" manifest file in editor**, and set the time zone to yours.
3. Replace `appsscript.json` and `Code.gs` with the files in this folder. If your time zone isn't New York, change `timeZone` in `appsscript.json` too.
4. Project Settings > Script properties, add:

   | Property | Value |
   | --- | --- |
   | `BACKPOCKET_URL` | `https://your-app.vercel.app` |
   | `BRIDGE_SECRET` | the same secret as on Vercel |
   | `PHONE` | your WhatsApp number with country code |
   | `OUTLOOK_ICS_URL` | optional, see below |

5. Pick `previewBrief` in the toolbar and click **Run**. Google asks for permission; it will say the app isn't verified, because it's your own script. Click **Advanced > Go to Backpocket bridge**. The log shows today's brief without sending it.
6. Run `installDailyTrigger` once. From tomorrow, `sendBrief` runs every morning between 6 and 7am.

`resendBrief` sends today's brief again, for testing.

## 3. Your UNC Outlook calendar (optional)

Coffee chats and classes on your UNC calendar can be included through a published calendar link:

1. Outlook on the web > Settings > Calendar > **Shared calendars** > **Publish a calendar**.
2. Pick your calendar, choose **Can view all details**, and click **Publish**.
3. Copy the **ICS** link into the `OUTLOOK_ICS_URL` script property.

If there's no "Publish a calendar" section, UNC has turned publishing off and this step won't work. Treat the link like a password: anyone who has it can see your calendar.

Application emails that go to your UNC inbox aren't read. Backpocket keeps reminding you about those posts until you reply with their numbers or "skip". If UNC allows forwarding to outside addresses, an Outlook rule that forwards "thank you for applying" emails to your Gmail closes the gap.

## 4. When WhatsApp holds the brief

WhatsApp only lets Backpocket send a free-form message within 24 hours of your last message to it. If you haven't written in a day, the brief is held and goes out the moment you send anything.

To get a nudge instead of silence, create a template in Meta's WhatsApp Manager:

- Category: Utility. Name: `backpocket_brief`. Language: English.
- Body: `Your Backpocket brief for today is ready.`
- Button: Quick reply, `Show my brief`.

Once it's approved, set `WHATSAPP_BRIEF_TEMPLATE=backpocket_brief` on Vercel.

## Trying it without waiting for 6am

```bash
npm run simulate-brief                         # dry run on localhost with a sample day
npm run simulate-brief -- --send               # really sends it
npm run simulate-brief -- https://your-app.vercel.app
```
