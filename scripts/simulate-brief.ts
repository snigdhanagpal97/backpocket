// Sends a signed morning-brief request, like the Apps Script bridge does, with
// a made-up calendar and inbox. Use it to see the brief without waiting for 6am.
//
//   npm run simulate-brief                     dry run against localhost: prints the brief, sends nothing
//   npm run simulate-brief -- --send           really sends it on WhatsApp (and marks applications)
//   npm run simulate-brief -- --file day.json  your own events and emails (same shape as the bridge)
//   npm run simulate-brief -- https://your-app.vercel.app
//
// Reads BRIDGE_SECRET and ALLOWED_PHONES from .env.local.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    send: { type: "boolean", default: false },
    file: { type: "string" },
    timezone: { type: "string", default: "America/New_York" },
  },
});

const base = (positionals[0] ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.BRIDGE_SECRET;
const phone = (process.env.ALLOWED_PHONES ?? "").split(",")[0]?.replace(/\D/g, "");
if (!secret || !phone) {
  console.error("Set BRIDGE_SECRET and ALLOWED_PHONES in .env.local first.");
  process.exit(1);
}

const timezone = values.timezone;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
// "GMT-04:00" -> "-04:00", so sample times land on the right local hour.
const offset =
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")
    ?.value.replace("GMT", "") || "+00:00";
const at = (hour: number) => new Date(`${today}T${String(hour).padStart(2, "0")}:00:00${offset}`).toISOString();

const sample = {
  events: [
    {
      id: "sim-1",
      title: "Coffee chat with Priya (Adobe)",
      start: at(14),
      end: at(15),
      all_day: false,
      description: "Talk about the PM internship and the team",
      attendees: [{ name: "Priya Shah", email: "priya@adobe.com" }],
    },
    { id: "sim-2", title: "Lunch", start: at(12), end: at(13), all_day: false },
    { id: "sim-3", title: "Fall break", start: at(0), end: at(23), all_day: true },
  ],
  emails: [
    {
      id: "sim-mail-1",
      from: "Nordstrom Careers <no-reply@us.greenhouse-mail.io>",
      subject: "Thank you for applying to Nordstrom",
      date: new Date().toISOString(),
      snippet: "We received your application for Product Management Intern. Our team will review it.",
    },
  ],
};

const day = values.file ? JSON.parse(readFileSync(values.file, "utf8")) : sample;
const body = JSON.stringify({
  phone,
  date: today,
  timezone,
  events: day.events ?? [],
  emails: day.emails ?? [],
  outlook_ics_url: day.outlook_ics_url,
  force: true,
  dry_run: !values.send,
});
const signature = "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

let response: Response;
try {
  response = await fetch(`${base}/api/brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-backpocket-signature": signature },
    body,
  });
} catch {
  console.error(`Couldn't reach ${base}. Is the server running (npm run dev)?`);
  process.exit(1);
}

const result = (await response.json()) as { status?: string; messages?: string[]; error?: string };
if (!response.ok) {
  console.error(`Failed (${response.status}):`, result);
  process.exit(1);
}
console.log(`Status: ${result.status}`);
for (const message of result.messages ?? []) console.log(`\n----- message -----\n${message}`);
if (!result.messages?.length) console.log("Nothing to send today.");
