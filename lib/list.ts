import type Anthropic from "@anthropic-ai/sdk";
import { callTool, ToolCallError } from "@/lib/claude";
import { getChatState, getSearchItems, matchItems, recordResurfacing, saveLastList, setDone } from "@/lib/db";
import { embed } from "@/lib/embed";
import {
  allDoneReply,
  listMessages,
  markDoneReply,
  NO_LIST_YET,
  NOTHING_TO_LIST,
  type OutgoingMessage,
} from "@/lib/replies";
import { listSelectionSchema, type Intent, type SearchItem } from "@/lib/types";

const CANDIDATES = 30;
const MAX_LISTED = 15;
const LIST_MEMORY_MS = 7 * 24 * 60 * 60 * 1000;

export const SELECT_TOOL: Anthropic.Beta.BetaTool = {
  name: "select_items",
  description: "Return every saved item that fits the request, and a short heading for the list.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["heading", "ids"],
    properties: {
      heading: {
        type: "string",
        description: 'A short heading for the list, under 60 characters, like "Summer 2027 internships you saved:".',
      },
      ids: {
        type: "array",
        items: { type: "string" },
        description: "Ids of every item that fits, most relevant first. Empty if none fit.",
      },
    },
  },
};

const SYSTEM_PROMPT = `Someone asked Backpocket, their WhatsApp saving bot, for a list of things they saved. You get the request and candidate items found by similarity search.

Return every item that genuinely fits the request, not just the closest few. Leave out items that only share a word or theme. Judge by title and summary only; never invent anything.

Always answer by calling the select_items tool.`;

function candidateLine(item: SearchItem): string {
  return `id: ${item.id}\ntitle: ${item.title ?? "(untitled)"}\nsummary: ${item.summary ?? ""}\nhas link: ${item.url ? "yes" : "no"}`;
}

async function selectItems(request: string, candidates: SearchItem[]) {
  const prompt = `Request: ${request}\n\nCandidates:\n\n${candidates.map(candidateLine).join("\n\n")}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const input = await callTool({ system: SYSTEM_PROMPT, content: [{ type: "text", text: prompt }], tool: SELECT_TOOL });
      const parsed = listSelectionSchema.safeParse(input);
      if (parsed.success) return parsed.data;
      console.warn("[list] invalid selection", { attempt, issues: parsed.error.issues });
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
      console.warn("[list] no selection", { attempt, error: error.message });
    }
  }
  throw new Error("list selection failed twice");
}

/** Most common label among done items, for "Leaving out 2 you already marked applied." */
function commonLabel(items: SearchItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.done_label ?? "done", (counts.get(item.done_label ?? "done") ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "done";
}

export async function listSaved(phone: string, intent: Intent, originalText: string): Promise<OutgoingMessage[]> {
  const query = intent.search_text || originalText;
  const matches = await matchItems(phone, await embed(query), CANDIDATES);
  const candidates = await getSearchItems(matches.map((match) => match.id));
  if (candidates.length === 0) return [{ text: NOTHING_TO_LIST, replyTo: null }];

  const selection = await selectItems(originalText, candidates);
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const fitting = [...new Set(selection.ids)].flatMap((id) => byId.get(id) ?? []);
  if (fitting.length === 0) return [{ text: NOTHING_TO_LIST, replyTo: null }];

  const done = fitting.filter((item) => item.done_at);
  const shown = (intent.include_done ? fitting : fitting.filter((item) => !item.done_at)).slice(0, MAX_LISTED);
  if (shown.length === 0) return [{ text: allDoneReply(done.length, commonLabel(done)), replyTo: null }];

  await saveLastList(phone, shown.map((item) => item.id));
  await recordResurfacing(
    shown.map((item) => item.id),
    "list",
  );
  const hidden = intent.include_done ? null : { count: done.length, label: commonLabel(done) };
  return listMessages(selection.heading, shown, hidden);
}

/** Titles of the last list, for the router, if it was sent recently enough to refer back to. */
export async function recentListTitles(phone: string): Promise<{ ids: string[]; titles: string[] }> {
  const state = await getChatState(phone);
  if (!state.lastListAt || Date.now() - state.lastListAt.getTime() > LIST_MEMORY_MS) return { ids: [], titles: [] };
  const items = await getSearchItems(state.lastList);
  return { ids: items.map((item) => item.id), titles: items.map((item) => item.title ?? "Untitled") };
}

export async function markFromList(
  phone: string,
  intent: Intent,
  lastList: { ids: string[] },
): Promise<string> {
  if (lastList.ids.length === 0) return NO_LIST_YET;
  const numbers = [...new Set(intent.numbers)];
  const badNumbers = numbers.filter((n) => n > lastList.ids.length);
  const ids = numbers.filter((n) => n <= lastList.ids.length).map((n) => lastList.ids[n - 1]);
  const label = intent.kind === "mark_done" ? intent.done_label || "done" : null;
  const titles = ids.length > 0 ? await setDone(phone, ids, label) : [];
  return markDoneReply(label, titles, { badNumbers, unmatched: intent.unmatched_names });
}
