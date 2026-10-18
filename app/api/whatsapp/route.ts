import { after, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { handleMessage } from "@/lib/handle-message";
import { messagesFromWebhook, whatsappWebhookSchema } from "@/lib/types";
import { verifySignature } from "@/lib/verify-signature";

// Upper bound for the work done in after(): extraction plus two model calls.
export const maxDuration = 60;

// Meta calls this once when you save the webhook URL in the dashboard.
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === env().WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifySignature(rawBody, signature, env().WHATSAPP_APP_SECRET)) {
    console.warn("[whatsapp] rejected webhook with bad or missing signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // A signed payload we don't understand still gets a 200, so Meta doesn't retry it forever.
  const parsed = whatsappWebhookSchema.safeParse(json);
  if (!parsed.success) {
    console.warn("[whatsapp] unexpected payload shape", parsed.error.issues);
    return new Response("OK", { status: 200 });
  }

  const allowed = new Set(env().ALLOWED_PHONES);
  const messages = messagesFromWebhook(parsed.data).filter((message) => {
    if (allowed.has(message.from)) return true;
    console.warn(`[whatsapp] dropped message ${message.id} from a number not in ALLOWED_PHONES`);
    return false;
  });

  if (messages.length > 0) {
    after(async () => {
      // One at a time, so a link and the screenshot that follows it arrive in order.
      for (const message of messages) {
        try {
          await handleMessage(message);
        } catch (error) {
          console.error("[whatsapp] handleMessage failed", {
            messageId: message.id,
            type: message.type,
            error: error instanceof Error ? error.message : error,
          });
        }
      }
    });
  }

  return new Response("OK", { status: 200 });
}
