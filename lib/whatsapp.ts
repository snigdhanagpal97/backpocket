import { z } from "zod";
import { env } from "@/lib/env";

export const GRAPH_API_VERSION = "v24.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function authHeaders() {
  return { Authorization: `Bearer ${env().WHATSAPP_TOKEN}` };
}

async function failure(what: string, response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  return new Error(`${what} failed: ${response.status} ${body.slice(0, 500)}`);
}

async function postText(to: string, body: string, replyTo?: string): Promise<Response> {
  return fetch(`${GRAPH_URL}/${env().WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      // Shows as a reply quoting that earlier message in the chat.
      ...(replyTo ? { context: { message_id: replyTo } } : {}),
      type: "text",
      text: { preview_url: true, body },
    }),
  });
}

/**
 * Sends a text message. With `replyTo`, it quotes that earlier message; if
 * WhatsApp won't quote it (too old, deleted), the text is sent without the quote.
 */
export async function sendText(to: string, body: string, options: { replyTo?: string | null } = {}): Promise<void> {
  const replyTo = options.replyTo ?? undefined;
  let response = await postText(to, body, replyTo);
  if (!response.ok && replyTo) {
    console.warn("[whatsapp] quoted reply failed, sending without quote", {
      replyTo,
      status: response.status,
      body: (await response.text().catch(() => "")).slice(0, 300),
    });
    response = await postText(to, body);
  }
  if (!response.ok) throw await failure("sendText", response);
}

const mediaInfoSchema = z.object({
  url: z.string(),
  mime_type: z.string(),
});

export type DownloadedMedia = { data: Buffer; mimeType: string };

/** Looks up a media id for its short-lived URL, then downloads the bytes. */
export async function downloadMedia(mediaId: string): Promise<DownloadedMedia> {
  const infoResponse = await fetch(`${GRAPH_URL}/${mediaId}`, { headers: authHeaders() });
  if (!infoResponse.ok) throw await failure(`media lookup ${mediaId}`, infoResponse);
  const info = mediaInfoSchema.parse(await infoResponse.json());

  const fileResponse = await fetch(info.url, { headers: authHeaders() });
  if (!fileResponse.ok) throw await failure(`media download ${mediaId}`, fileResponse);

  return {
    data: Buffer.from(await fileResponse.arrayBuffer()),
    mimeType: info.mime_type,
  };
}
