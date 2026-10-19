// The morning brief: what to read before today's meetings, which saved job
// posts still need an application, and which ones an email says you applied to.

import type Anthropic from "@anthropic-ai/sdk";
import { matchConfirmations, pickReminders } from "@/lib/applications";
import { dayBounds, eventSearchText, eventsWorthPrepping, fetchOutlookEvents } from "@/lib/calendar";
import { callTool, ToolCallError } from "@/lib/claude";
import {
  getBriefState,
  getSearchItems,
  markReminded,
  matchItems,
  openJobs,
  recordResurfacing,
  saveLastList,
  savePendingBrief,
  setBriefSent,
  setDone,
  takePendingBrief,
} from "@/lib/db";
import { embed } from "@/lib/embed";
import { env } from "@/lib/env";
import { briefMessages, type BriefPrep, type OutgoingMessage } from "@/lib/replies";
import { prepPickSchema, type BriefRequest, type CalendarEvent, type SearchItem } from "@/lib/types";
import { OUTSIDE_WINDOW_CODE, sendTemplate, sendText, WhatsAppError } from "@/lib/whatsapp";

const DAY_MS = 24 * 60 * 60 * 1000;
const JOB_LOOKBACK_MS = 120 * DAY_MS;
const CANDIDATES_PER_EVENT = 6;
const MAX_PREP_EVENTS = 3;
/** A held brief is only worth sending the same day. */
export const PENDING_BRIEF_MAX_AGE_MS = 16 * 60 * 60 * 1000;

export const PICK_TOOL: Anthropic.Beta.BetaTool = {
  name: "pick_prep",
  description: "For each event, the saved items worth reading before it, with one line on why.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["events"],
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["event_id", "items"],
          properties: {
            event_id: { type: "string" },
            items: {
              type: "array",
              description: "0 to 3 items. Empty unless an item clearly helps with this event.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["item_id", "note"],
                properties: {
                  item_id: { type: "string" },
                  note: {
                    type: "string",
                    description:
                      "Under 100 characters: the most useful point from the item for this event, taken from the item.",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const PICK_PROMPT = `You prepare someone for today's calendar using things they saved earlier (LinkedIn posts, articles, screenshots, notes). For each event you get the event and saved items found by similarity search.

Pick an item for an event only if reading it would actually help with that event: it is about the same company or person, or the exact topic of the meeting or class. Sharing a word or a broad theme is not enough. Most events get nothing, and an empty list is far better than a loose match.

For each pick, write a note under 100 characters with the single most useful point from the item for this event, like "Their PM loop has a product sense round and a metrics round." Use only what the item says. Never add outside knowledge.

Always answer by calling the pick_prep tool.`;

function eventBlock(event: CalendarEvent, candidates: SearchItem[]): string {
  const items = candidates.map((item) =>
    [
      `  item id: ${item.id}`,
      `  title: ${item.title ?? "(untitled)"}`,
      `  summary: ${item.summary ?? ""}`,
      item.key_points.length ? `  key points: ${item.key_points.slice(0, 5).join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return `event id: ${event.id}\n${eventSearchText(event)}\n\nSaved items:\n${items.join("\n\n") || "  (none)"}`;
}

/** Saved items worth reading before each event. Events with no good match are left out. */
export async function prepForEvents(phone: string, events: CalendarEvent[]): Promise<BriefPrep[]> {
  if (events.length === 0) return [];

  const candidateIds = await Promise.all(
    events.map(async (event) => {
      const matches = await matchItems(phone, await embed(eventSearchText(event)), CANDIDATES_PER_EVENT);
      return matches.map((match) => match.id);
    }),
  );
  const items = await getSearchItems([...new Set(candidateIds.flat())]);
  if (items.length === 0) return [];
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const prompt = events
    .map((event, i) => eventBlock(event, candidateIds[i].flatMap((id) => itemsById.get(id) ?? [])))
    .join("\n\n---\n\n");

  let picks: ReturnType<typeof prepPickSchema.parse> | null = null;
  let lastProblem = "";
  for (let attempt = 1; attempt <= 2 && !picks; attempt++) {
    try {
      const input = await callTool({
        system: PICK_PROMPT,
        content: [{ type: "text", text: prompt + (lastProblem ? `\n\nYour last answer was rejected: ${lastProblem}` : "") }],
        tool: PICK_TOOL,
      });
      const parsed = prepPickSchema.safeParse(input);
      if (parsed.success) picks = parsed.data;
      else lastProblem = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
      lastProblem = error.message;
    }
  }
  if (!picks) throw new Error(`prep picking failed twice: ${lastProblem}`);

  return validPrep(picks.events, events, candidateIds, itemsById).slice(0, MAX_PREP_EVENTS);
}

/** Keeps only picks that were real candidates for that event, and each item once across the brief. */
export function validPrep(
  picks: { event_id: string; items: { item_id: string; note: string }[] }[],
  events: CalendarEvent[],
  candidateIds: string[][],
  itemsById: Map<string, Pick<SearchItem, "id" | "title" | "url">>,
): BriefPrep[] {
  const used = new Set<string>();
  const byEvent = new Map(picks.map((pick) => [pick.event_id, pick.items]));
  return events.flatMap((event, i) => {
    const allowed = new Set(candidateIds[i]);
    const chosen = (byEvent.get(event.id) ?? []).flatMap((pick) => {
      const item = itemsById.get(pick.item_id);
      if (!item || !allowed.has(pick.item_id) || used.has(pick.item_id)) return [];
      used.add(pick.item_id);
      return [{ id: item.id, title: item.title, url: item.url, note: pick.note }];
    });
    return chosen.length > 0 ? [{ start: event.start, title: event.title, items: chosen.slice(0, 3) }] : [];
  });
}

/**
 * Sends the brief. If WhatsApp refuses because the user hasn't written in 24
 * hours, holds it and sends the approved "brief is ready" template instead;
 * it goes out as soon as they reply. Returns whether it was delivered now.
 */
async function deliver(phone: string, messages: OutgoingMessage[]): Promise<boolean> {
  try {
    await sendText(phone, messages[0].text);
  } catch (error) {
    if (!(error instanceof WhatsAppError) || error.code !== OUTSIDE_WINDOW_CODE) throw error;
    await savePendingBrief(
      phone,
      messages.map((message) => message.text),
    );
    const template = env().WHATSAPP_BRIEF_TEMPLATE;
    if (template) await sendTemplate(phone, template, env().WHATSAPP_BRIEF_TEMPLATE_LANG);
    else console.warn("[brief] held until the user writes; set WHATSAPP_BRIEF_TEMPLATE to nudge them");
    return false;
  }
  for (const message of messages.slice(1)) await sendText(phone, message.text);
  return true;
}

/** Sends a brief that was held for the 24-hour window. True if there was one. */
export async function deliverPendingBrief(phone: string): Promise<boolean> {
  const texts = await takePendingBrief(phone, PENDING_BRIEF_MAX_AGE_MS);
  if (!texts || texts.length === 0) return false;
  for (const text of texts) await sendText(phone, text);
  return true;
}

export type BriefResult = {
  status: "sent" | "held" | "quiet" | "skipped" | "dry_run";
  reason?: string;
  events_considered: number;
  prep_events: number;
  applied_from_email: number;
  reminders: number;
  messages: string[];
};

async function orEmpty<T>(label: string, work: Promise<T[]>): Promise<T[]> {
  try {
    return await work;
  } catch (error) {
    // One broken part (say, prep picking) shouldn't cost the whole brief.
    console.error(`[brief] ${label} failed`, { error: error instanceof Error ? error.message : error });
    return [];
  }
}

export async function runBrief(request: BriefRequest, now = new Date()): Promise<BriefResult> {
  const { phone } = request;
  const empty = { events_considered: 0, prep_events: 0, applied_from_email: 0, reminders: 0, messages: [] };

  if (!request.force && !request.dry_run && (await getBriefState(phone)).lastBriefDate === request.date) {
    return { status: "skipped", reason: "already sent today", ...empty };
  }

  const day = dayBounds(request.date, request.timezone);
  const outlook = request.outlook_ics_url ? await fetchOutlookEvents(request.outlook_ics_url, day) : [];
  const events = eventsWorthPrepping([...request.events, ...outlook]);
  const jobs = await openJobs(phone, new Date(now.getTime() - JOB_LOOKBACK_MS));

  const [applied, prep] = await Promise.all([
    orEmpty("application matching", matchConfirmations(jobs, request.emails)),
    orEmpty("prep", prepForEvents(phone, events)),
  ]);
  const appliedIds = new Set(applied.map(({ job }) => job.id));
  const reminders = pickReminders(
    jobs.filter((job) => !appliedIds.has(job.id)),
    request.date,
    now,
  );

  const messages = briefMessages({
    today: request.date,
    timeZone: request.timezone,
    prep,
    reminders,
    applied: applied.map(({ job }) => job),
  });
  const result = {
    events_considered: events.length,
    prep_events: prep.length,
    applied_from_email: applied.length,
    reminders: reminders.length,
    messages: messages.map((message) => message.text),
  };
  if (request.dry_run) return { status: "dry_run", ...result };

  for (const { job, email } of applied) {
    await setDone(phone, [job.id], "applied", { source: "email", at: new Date(email.date) });
  }

  // Quiet days get no message at all.
  if (messages.length === 0) {
    await setBriefSent(phone, request.date);
    return { status: "quiet", ...result };
  }

  const delivered = await deliver(phone, messages);
  if (reminders.length > 0) {
    // So "1, 3" or "skip 2" refers to this list.
    await saveLastList(
      phone,
      reminders.map((job) => job.id),
    );
    await markReminded(reminders.map((job) => job.id));
    await recordResurfacing(
      reminders.map((job) => job.id),
      "reminder",
    );
  }
  await recordResurfacing(
    prep.flatMap((event) => event.items.map((item) => item.id)),
    "brief",
  );
  await setBriefSent(phone, request.date);
  return { status: delivered ? "sent" : "held", ...result };
}
