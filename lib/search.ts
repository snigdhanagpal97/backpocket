import type Anthropic from "@anthropic-ai/sdk";
import { callTool, ToolCallError } from "@/lib/claude";
import { getSearchItems, matchItems, recordResurfacing } from "@/lib/db";
import { embed } from "@/lib/embed";
import { NOTHING_FOUND, searchMessages, type OutgoingMessage } from "@/lib/replies";
import { searchAnswerSchema, type SearchAnswer, type SearchItem } from "@/lib/types";

const CANDIDATES = 5;
const MAX_ITEM_TEXT = 1500;

export const ANSWER_TOOL: Anthropic.Beta.BetaTool = {
  name: "answer_question",
  description: "Answer the question from the saved items, and say which items the answer used.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["answer", "used_ids"],
    properties: {
      answer: {
        type: "string",
        description: "The answer itself, under 280 characters, plain text. Empty if no item answers the question.",
      },
      used_ids: {
        type: "array",
        items: { type: "string" },
        description: "Ids of the 0 to 3 items the answer is based on, most useful first.",
      },
    },
  },
};

const SYSTEM_PROMPT = `Someone asked a question in WhatsApp about things they saved earlier: links, screenshots, posts, notes. You get the question and up to 5 saved items found by similarity search, with their content.

Answer like a sharp friend who read their saves: the answer first, then only the details that matter.

Bad: "Aditi said your framework is good. She has some tips for growth cases and wants to go over them quickly when you meet tomorrow. Her other notes: - Your sheet needs to be neater, but that will come with time..."
Good: "Aditi liked the framework. Fixes: neater sheet, key question at the top so you can tie back to it. GBOT was solid."

Rules:
- Lead with the direct answer. No preamble, no restating the question, no "Her other notes", no sign-off.
- Under 280 characters. At most 3 "- " bullets, only when listing distinct things.
- Keep names, numbers, dates and pay. Cut filler and anything that doesn't answer the question.
- Use only what the items say. Never invent or add outside knowledge.
- Similar is not enough. Use an item only if it actually helps answer. If none do, return an empty answer and no ids.
- Plain text for WhatsApp, speaking to the person as "you". Don't mention items, ids, search or screenshots.

Always answer by calling the answer_question tool.`;

function itemText(item: SearchItem): string {
  const raw = (item.raw_text ?? "").slice(0, MAX_ITEM_TEXT);
  return [
    `id: ${item.id}`,
    `type: ${item.item_type ?? "unknown"}`,
    `title: ${item.title ?? "(untitled)"}`,
    `summary: ${item.summary ?? ""}`,
    item.key_points.length ? `key points:\n${item.key_points.map((point) => `- ${point}`).join("\n")}` : "",
    raw ? `saved text:\n${raw}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Asks Claude to answer from the candidates. Retries once on bad output. */
async function answerFromItems(question: string, candidates: SearchItem[]): Promise<SearchAnswer> {
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const prompt = `Question: ${question}\n\nSaved items:\n\n${candidates.map(itemText).join("\n\n---\n\n")}`;
  let lastProblem = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const input = await callTool({
        system: SYSTEM_PROMPT,
        content: [{ type: "text", text: prompt + (lastProblem ? `\n\nYour last answer was rejected: ${lastProblem}` : "") }],
        tool: ANSWER_TOOL,
        maxTokens: 3000,
      });
      const parsed = searchAnswerSchema.safeParse(input);
      if (parsed.success) {
        const items = [...new Set(parsed.data.used_ids)].flatMap((id) => byId.get(id) ?? []);
        return { answer: items.length ? parsed.data.answer : "", items };
      }
      lastProblem = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
      lastProblem = error.message;
    }
    console.warn("[search] answer attempt failed", { attempt, problem: lastProblem });
  }
  throw new Error(`search answer failed twice: ${lastProblem}`);
}

/** Answers a question from the user's saved items, as one or more WhatsApp messages. */
export async function answerQuestion(
  phone: string,
  searchText: string,
  question = searchText,
): Promise<OutgoingMessage[]> {
  const matches = await matchItems(phone, await embed(searchText), CANDIDATES);
  const candidates = await getSearchItems(matches.map((match) => match.id));
  if (candidates.length === 0) return [{ text: NOTHING_FOUND, replyTo: null }];

  const { answer, items } = await answerFromItems(question, candidates);
  if (!answer || items.length === 0) return [{ text: NOTHING_FOUND, replyTo: null }];

  await recordResurfacing(
    items.map((item) => item.id),
    "search",
  );
  return searchMessages(answer, items);
}
