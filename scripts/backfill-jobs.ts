// Marks job and internship posts you saved before Backpocket detected them,
// so the morning brief can remind you about them. Safe to run more than once.
//
//   npm run backfill-jobs -- https://your-app.vercel.app
//
// Reads BRIDGE_SECRET and ALLOWED_PHONES from .env.local. Defaults to localhost.

import { createHmac } from "node:crypto";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.BRIDGE_SECRET;
const phone = (process.env.ALLOWED_PHONES ?? "").split(",")[0]?.replace(/\D/g, "");
if (!secret || !phone) {
  console.error("Set BRIDGE_SECRET and ALLOWED_PHONES in .env.local first.");
  process.exit(1);
}

let afterId: string | null = null;
let checked = 0;
let jobs = 0;
do {
  const body = JSON.stringify({ phone, after_id: afterId });
  const signature = "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const response = await fetch(`${base}/api/backfill-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-backpocket-signature": signature },
    body,
  });
  const result = (await response.json()) as { checked?: number; jobs?: number; next?: string | null; error?: string };
  if (!response.ok) {
    console.error(`Failed (${response.status}): ${result.error ?? "unknown error"}`);
    process.exit(1);
  }
  checked += result.checked ?? 0;
  jobs += result.jobs ?? 0;
  afterId = result.next ?? null;
  console.log(`Checked ${checked} items, found ${jobs} job posts so far`);
} while (afterId);
console.log("Done.");
