import type Anthropic from "@anthropic-ai/sdk";
import { callTool, ToolCallError } from "@/lib/claude";
import { matchItems, recordResurfacing } from "@/lib/db";
import { embed } from "@/lib/embed";
import { NOTHING_FOUND, searchReply } from "@/lib/replies";
import { searchPicksSchema, type MatchedItem, type SearchPick } from "@/lib/types";

const CANDIDATES = 5;

export const PICK_TOOL: Anthropic.Beta.BetaTool = {
  name: "pick_items",
  description: "Return the saved items that answer the question, best first.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["picks"],
    properties: {
      picks: {
        type: "array",
        description: "0 to 3 items. Empty if none of them answer the question.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "why"],
          properties: {
            id: { type: "string", description: "The id of a candidate item." },
            why: { type: "string", description: "One short line, under 90 characters, on why it fits." },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `Someone asked a question in chat about things they saved earlier. You get their question and up to 5 saved items found by similarity search.

Pick the 1 to 3 items that actually answer the question, best first. Similar is not enough: skip items that only share a word or a theme. If none fit, return an empty list.

For each pick, write one short line on why it fits, in plain words, speaking to the person (for example: "Uses paneer and spinach, about 35 minutes"). Use only what the item says. Never invent details.

Always answer by calling the pick_items tool.`;

function candidateText(question: string, candidates: MatchedItem[]): string {
  const items = candidates.map((item) =>
    [
      `id: ${item.id}`,
      `type: ${item.item_type ?? "unknown"}`,
      `title: ${item.title ?? "(untitled)"}`,
      `summary: ${item.summary ?? ""}`,
    ].join("\n"),
  );
  return `Question: ${question}\n\nSaved items:\n\n${items.join("\n\n")}`;
}

/** Asks Claude which candidates answer the question. Retries once on bad output. */
async function pickMatches(question: string, candidates: MatchedItem[]): Promise<SearchPick[]> {
  const byId = new Map(candidates.map((item) => [item.id, item]));
  let lastProblem = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = candidateText(question, candidates) + (lastProblem ? `\n\nYour last answer was rejected: ${lastProblem}` : "");
    try {
      const input = await callTool({
        system: SYSTEM_PROMPT,
        content: [{ type: "text", text }],
        tool: PICK_TOOL,
        maxTokens: 2000,
      });
      const parsed = searchPicksSchema.safeParse(input);
      if (parsed.success) {
        // Keep only ids we actually offered, once each.
        const seen = new Set<string>();
        return parsed.data.picks.flatMap(({ id, why }) => {
          const item = byId.get(id);
          if (!item || seen.has(id)) return [];
          seen.add(id);
          return [{ item, why }];
        });
      }
      lastProblem = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
      lastProblem = error.message;
    }
    console.warn("[search] pick attempt failed", { attempt, problem: lastProblem });
  }
  throw new Error(`search picks failed twice: ${lastProblem}`);
}

/** Answers a question from the user's saved items, as a WhatsApp reply. */
export async function answerQuestion(phone: string, question: string): Promise<string> {
  const candidates = await matchItems(phone, await embed(question), CANDIDATES);
  if (candidates.length === 0) return NOTHING_FOUND;

  const picks = await pickMatches(question, candidates);
  if (picks.length === 0) return NOTHING_FOUND;

  await recordResurfacing(
    picks.map((pick) => pick.item.id),
    "search",
  );
  return searchReply(picks);
}
