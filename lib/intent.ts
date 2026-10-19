import type Anthropic from "@anthropic-ai/sdk";
import { isQuestion } from "@/lib/classify";
import { callTool, ToolCallError } from "@/lib/claude";
import { INTENT_KINDS, intentSchema, type Intent } from "@/lib/types";

export const ROUTE_TOOL: Anthropic.Beta.BetaTool = {
  name: "route_message",
  description: "Say what the person wants from this message.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "search_text", "numbers", "unmatched_names", "done_label", "include_done"],
    properties: {
      kind: { type: "string", enum: [...INTENT_KINDS] },
      search_text: {
        type: "string",
        description: "For question or list: what to search their saves for, as a short phrase. Otherwise empty.",
      },
      numbers: {
        type: "array",
        items: { type: "integer" },
        description: "For mark_done or unmark_done: positions in the last list they mean, including ones named by title.",
      },
      unmatched_names: {
        type: "array",
        items: { type: "string" },
        description: "Things they named that are not in the last list.",
      },
      done_label: {
        type: "string",
        description: 'For mark_done: one or two lowercase past-tense words for what they did, like "applied", "cooked", "read". Otherwise empty.',
      },
      include_done: {
        type: "boolean",
        description: "For list: true only if they also want items they already acted on.",
      },
    },
  },
};

const SYSTEM_PROMPT = `You route WhatsApp messages sent to Backpocket, a bot that saves links, screenshots and notes and finds them later.

kind:
- note: something to remember. A statement, reminder, idea or fact the person is telling the bot. "Ask Priya about the pricing deck Friday."
- question: they want a specific answer from what they saved. "What did Aditi say about growth cases?"
- list: they want several or all saved items that fit something. "Share all summer 2027 internship links", "which companies have I saved", "list my paneer recipes".
- mark_done: they say they acted on items from the last list. "Applied to 1 and 3", "done with Nordstrom", "2".
- unmark_done: they take that back. "I didn't apply to 2 after all."

A request is never a note, even without a question mark: "can you share…", "send me…", "show…", "give me…" are question or list.
A message that is only numbers, sent right after a list, is mark_done.

Always answer by calling the route_message tool.`;

function lastListText(titles: string[]): string {
  if (titles.length === 0) return "No recent list.";
  return `Last list sent to them:\n${titles.map((title, i) => `${i + 1}. ${title}`).join("\n")}`;
}

/** Decides what a link-free message is for. Falls back to the keyword check if Claude fails. */
export async function routeMessage(text: string, lastListTitles: string[]): Promise<Intent> {
  try {
    const input = await callTool({
      system: SYSTEM_PROMPT,
      content: [{ type: "text", text: `${lastListText(lastListTitles)}\n\nMessage: ${text}` }],
      tool: ROUTE_TOOL,
      maxTokens: 1000,
    });
    const parsed = intentSchema.safeParse(input);
    if (parsed.success) return parsed.data;
    console.warn("[intent] invalid route", { issues: parsed.error.issues });
  } catch (error) {
    if (!(error instanceof ToolCallError)) throw error;
    console.warn("[intent] no route", { error: error.message });
  }
  return {
    kind: isQuestion(text) ? "question" : "note",
    search_text: text,
    numbers: [],
    unmatched_names: [],
    done_label: "",
    include_done: false,
  };
}
