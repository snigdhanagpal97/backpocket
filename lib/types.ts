import { z } from "zod";

// WhatsApp Cloud API webhook payload. Only the fields Backpocket reads are
// listed; zod drops the rest.

export const whatsappMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  // Tapping a quick-reply button on a template message.
  button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
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

export const ITEM_TYPES = ["recipe", "post", "how_to", "job", "note", "other"] as const;

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
  /** For job and internship posts. Empty strings otherwise. */
  job: z.object({
    company: z.string().trim().max(80),
    role: z.string().trim().max(120),
    deadline: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "deadline is YYYY-MM-DD or empty"),
  }),
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

// ---------- morning brief ----------

const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "not a date");

export const calendarEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().max(300),
  start: isoDateTime,
  end: isoDateTime,
  all_day: z.boolean(),
  description: z.string().max(4000).default(""),
  location: z.string().max(500).default(""),
  attendees: z
    .array(z.object({ name: z.string().max(200).default(""), email: z.string().max(320).default("") }))
    .max(100)
    .default([]),
  calendar: z.enum(["google", "outlook"]).default("google"),
});

export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** An email that looks like a job application confirmation. Only metadata and a snippet. */
export const applicationEmailSchema = z.object({
  id: z.string().min(1),
  from: z.string().max(400),
  subject: z.string().max(500),
  date: isoDateTime,
  snippet: z.string().max(1000).default(""),
});

export type ApplicationEmail = z.infer<typeof applicationEmailSchema>;

/** What the Apps Script bridge sends each morning. */
export const briefRequestSchema = z.object({
  phone: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().min(6)),
  /** The user's local date, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1).refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "unknown time zone"),
  events: z.array(calendarEventSchema).max(80).default([]),
  emails: z.array(applicationEmailSchema).max(60).default([]),
  /** Published Outlook calendar (ICS). Fetched by the server. */
  outlook_ics_url: z.url().optional().or(z.literal("").transform(() => undefined)),
  /** Send even if today's brief already went out. For testing. */
  force: z.boolean().default(false),
  /** Build the brief and return it without sending or changing anything. */
  dry_run: z.boolean().default(false),
});

export type BriefRequest = z.infer<typeof briefRequestSchema>;

/** A saved job post still waiting for an application. */
export type OpenJob = {
  id: string;
  title: string | null;
  url: string | null;
  job_company: string | null;
  job_role: string | null;
  job_deadline: string | null;
  created_at: string;
  last_reminded_at: string | null;
};

export const applicationMatchSchema = z.object({
  matches: z.array(z.object({ item_id: z.string().min(1), email_id: z.string().min(1) })),
});

export const prepPickSchema = z.object({
  events: z.array(
    z.object({
      event_id: z.string().min(1),
      items: z
        .array(
          z.object({
            item_id: z.string().min(1),
            note: z.string().trim().max(120, "keep each note under 100 characters"),
          }),
        )
        .max(3),
    }),
  ),
});

export const jobCheckSchema = z.object({
  jobs: z.array(
    z.object({
      item_id: z.string().min(1),
      company: z.string().trim().max(80),
      role: z.string().trim().max(120),
      deadline: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/),
    }),
  ),
});
