// Sends a signed, realistic WhatsApp webhook to Backpocket.
//
//   npm run simulate -- --text "https://example.com"
//   npm run simulate -- --image MEDIA_ID --caption "dinner idea"
//   npm run simulate -- --text "hello" https://your-app.vercel.app/api/whatsapp
//
// Options: --from <digits> (default: first ALLOWED_PHONES), --id <message id>
// (reuse one to test dedupe). Reads WHATSAPP_APP_SECRET from .env.local.

import { createHmac, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    text: { type: "string" },
    image: { type: "string" },
    caption: { type: "string" },
    from: { type: "string" },
    id: { type: "string" },
  },
});

const url = positionals[0] ?? "http://localhost:3000/api/whatsapp";
const secret = process.env.WHATSAPP_APP_SECRET;
if (!secret) {
  console.error("WHATSAPP_APP_SECRET is not set. Add it to .env.local.");
  process.exit(1);
}

const from =
  values.from ?? process.env.ALLOWED_PHONES?.split(",")[0]?.replace(/\D/g, "") ?? "";
if (!from) {
  console.error("No sender. Pass --from or set ALLOWED_PHONES in .env.local.");
  process.exit(1);
}

if (!values.text && !values.image) {
  console.error('Pass --text "..." or --image MEDIA_ID.');
  process.exit(1);
}

const messageId = values.id ?? `wamid.SIM${randomBytes(12).toString("hex").toUpperCase()}`;
const timestamp = String(Math.floor(Date.now() / 1000));

const message = values.image
  ? {
      from,
      id: messageId,
      timestamp,
      type: "image",
      image: {
        id: values.image,
        mime_type: "image/jpeg",
        sha256: randomBytes(32).toString("base64"),
        ...(values.caption ? { caption: values.caption } : {}),
      },
    }
  : { from, id: messageId, timestamp, type: "text", text: { body: values.text } };

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "SIMULATED_WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550000000",
              phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || "SIMULATED_PHONE_NUMBER_ID",
            },
            contacts: [{ profile: { name: "Simulator" }, wa_id: from }],
            messages: [message],
          },
        },
      ],
    },
  ],
};

const body = JSON.stringify(payload);
const signature = "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
  body,
});

console.log(`POST ${url}`);
console.log(`message ${messageId} (${message.type}) from ${from}`);
console.log(`-> ${response.status} ${await response.text()}`);
if (!response.ok) process.exit(1);
