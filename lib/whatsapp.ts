import { z } from "zod";
import { env } from "@/lib/env";

export const GRAPH_API_VERSION = "v24.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function authHeaders() {
  return { Authorization: `Bearer ${env().WHATSAPP_TOKEN}` };
}

/** A Graph API error, with Meta's error code when the body has one. */
export class WhatsAppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: number | null,
  ) {
    super(message);
  }
}

/**
 * Meta's code for a free-form message sent more than 24 hours after the
 * user's last message. Only an approved template can go out then.
 */
export const OUTSIDE_WINDOW_CODE = 131047;

export function errorCode(body: string): number | null {
  try {
    const code = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "number" ? code : null;
  } catch {
    return null;
  }
}

async function failure(what: string, response: Response, body?: string): Promise<WhatsAppError> {
  const text = body ?? (await response.text().catch(() => ""));
  return new WhatsAppError(`${what} failed: ${response.status} ${text.slice(0, 500)}`, response.status, errorCode(text));
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
    const errorBody = await response.text().catch(() => "");
    // Outside the 24-hour window nothing free-form gets through, quoted or not.
    if (errorCode(errorBody) === OUTSIDE_WINDOW_CODE) throw await failure("sendText", response, errorBody);
    console.warn("[whatsapp] quoted reply failed, sending without quote", {
      replyTo,
      status: response.status,
      body: errorBody.slice(0, 300),
    });
    response = await postText(to, body);
  }
  if (!response.ok) throw await failure("sendText", response);
}

/** Sends an approved template with no variables, like the "your brief is ready" nudge. */
export async function sendTemplate(to: string, name: string, language: string): Promise<void> {
  const response = await fetch(`${GRAPH_URL}/${env().WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name, language: { code: language } },
    }),
  });
  if (!response.ok) throw await failure(`sendTemplate ${name}`, response);
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
