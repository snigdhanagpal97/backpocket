import { z } from "zod";

// WhatsApp Cloud API webhook payload. Only the fields Backpocket reads are
// listed; zod drops the rest.

export const whatsappMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z
    .object({
      id: z.string(),
      mime_type: z.string().optional(),
      caption: z.string().optional(),
    })
    .optional(),
});

export type WhatsAppMessage = z.infer<typeof whatsappMessageSchema>;

export const whatsappWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            messaging_product: z.string().optional(),
            metadata: z
              .object({
                display_phone_number: z.string(),
                phone_number_id: z.string(),
              })
              .optional(),
            messages: z.array(whatsappMessageSchema).optional(),
          }),
        }),
      ),
    }),
  ),
});

export type WhatsAppWebhook = z.infer<typeof whatsappWebhookSchema>;

/** Every message in a webhook, across entries and changes. Status updates have none. */
export function messagesFromWebhook(payload: WhatsAppWebhook): WhatsAppMessage[] {
  return payload.entry.flatMap((entry) =>
    entry.changes.flatMap((change) => change.value.messages ?? []),
  );
}

// Extraction output, shared by extract, card building and storage.

export type Source =
  | "screenshot"
  | "linkedin"
  | "instagram"
  | "recipe_web"
  | "web"
  | "query"
  | "note";

export type ExtractStatus = "complete" | "needs_fallback";

export type ExtractedContent = {
  source: Source;
  url: string | null;
  /** Everything we could read, labeled, for the card builder. */
  rawText: string;
  /** Text the user typed alongside a link, or an image caption. */
  userNote: string | null;
  imageBase64?: string;
  mimeType?: string;
  /** Path inside the screenshots bucket. */
  imagePath?: string;
  status: ExtractStatus;
};

// Card built by Claude from extracted content. Constraints are enforced here,
// because strict tool schemas can't express string lengths.

export const ITEM_TYPES = ["recipe", "post", "how_to", "note", "other"] as const;

const topic = z
  .string()
  .transform((value) => value.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-"))
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "topics are single lowercase words or hyphenated"));

export const cardSchema = z.object({
  item_type: z.enum(ITEM_TYPES),
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(400),
  key_points: z.array(z.string().trim().min(1)).max(8),
  entities: z.object({
    people: z.array(z.string().trim().min(1)),
    companies: z.array(z.string().trim().min(1)),
  }),
  topics: z.array(topic).min(2).max(5),
  /** Text read from the image, close to verbatim. Empty when there is no image. */
  image_text: z.string().trim().max(8000),
});

export type Card = z.infer<typeof cardSchema>;

// Search: what match_items returns, and Claude's pick of the ones that answer.

export type MatchedItem = {
  id: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  item_type: string | null;
  similarity: number;
};

/** A matched item with the content search needs to answer from. */
export type SearchItem = {
  id: string;
  title: string | null;
  summary: string | null;
  key_points: string[];
  raw_text: string | null;
  url: string | null;
  item_type: string | null;
  wa_message_id: string | null;
  done_at: string | null;
  done_label: string | null;
};

export const searchAnswerSchema = z.object({
  // The prompt asks for about 200; anything past 280 is sent back for a shorter try.
  answer: z.string().trim().max(280, "too long, cut it to about 200 characters"),
  used_ids: z.array(z.string().min(1)).max(3),
});

export type SearchAnswer = { answer: string; items: SearchItem[] };

// Intent of a message with no link, decided by Claude.

export const INTENT_KINDS = ["note", "question", "list", "mark_done", "unmark_done"] as const;

export const intentSchema = z.object({
  kind: z.enum(INTENT_KINDS),
  search_text: z.string().trim(),
  numbers: z.array(z.number().int().min(1)),
  unmatched_names: z.array(z.string().trim().min(1)),
  done_label: z.string().trim().toLowerCase().max(30),
  include_done: z.boolean(),
});

export type Intent = z.infer<typeof intentSchema>;

export const listSelectionSchema = z.object({
  heading: z.string().trim().max(80),
  ids: z.array(z.string().min(1)),
});
