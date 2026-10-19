import type Anthropic from "@anthropic-ai/sdk";
import { callTool, ToolCallError } from "@/lib/claude";
import { cardSchema, ITEM_TYPES, type Card, type ExtractedContent } from "@/lib/types";

const stringArray = { type: "array", items: { type: "string" } } as const;

export const SAVE_CARD_TOOL: Anthropic.Beta.BetaTool = {
  name: "save_card",
  description: "Save the structured card for this item.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["item_type", "title", "summary", "key_points", "entities", "topics"],
    properties: {
      item_type: { type: "string", enum: [...ITEM_TYPES] },
      title: { type: "string", description: "Short, specific title. 60 characters or fewer." },
      summary: { type: "string", description: "One or two plain sentences on what this is. Never more than two." },
      key_points: {
        ...stringArray,
        description:
          "Up to 8. Recipes: ingredients, then steps. how_to: the tips. Posts: the main points. Empty if there is nothing concrete.",
      },
      entities: {
        type: "object",
        additionalProperties: false,
        required: ["people", "companies"],
        properties: { people: stringArray, companies: stringArray },
      },
      topics: {
        ...stringArray,
        description: "2 to 5 lowercase tags, single words or hyphenated, e.g. paneer, weeknight-dinner.",
      },
    },
  },
};

const SYSTEM_PROMPT = `You turn something a person saved (a web page, a social post, a screenshot or a note) into a card they can find later.

Use only the content you are given: the page text, the image, the link and the person's own note. Never invent details. Do not add ingredients, steps, numbers, names or claims that are not in the content. If the content is thin, keep the card short and leave key_points empty rather than guessing.

item_type: recipe for anything with ingredients or cooking steps, how_to for instructions or tips, post for social posts and articles, note for the person's own thoughts, other for everything else.

The summary is one or two sentences, never more.

If the person wrote a note, it tells you why they saved it. Let it shape the title and topics, but don't present it as part of the source.

Always answer by calling the save_card tool.`;

function contentBlocks(extracted: ExtractedContent): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (extracted.imageBase64 && extracted.mimeType) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: extracted.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: extracted.imageBase64,
      },
    });
  }
  const lines = [
    `Source: ${extracted.source}`,
    extracted.url ? `Link: ${extracted.url}` : "",
    extracted.rawText ? `Content:\n${extracted.rawText}` : "Content: (none besides the image)",
  ].filter(Boolean);
  blocks.push({ type: "text", text: lines.join("\n") });
  return blocks;
}

/** Builds a card with Claude. Retries once if the output doesn't validate. */
export async function buildCard(extracted: ExtractedContent): Promise<Card> {
  const content = contentBlocks(extracted);
  let lastProblem = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryNote: Anthropic.Beta.BetaContentBlockParam[] = lastProblem
      ? [{ type: "text", text: `Your last card was rejected: ${lastProblem}. Call save_card again and fix that.` }]
      : [];
    try {
      const input = await callTool({ system: SYSTEM_PROMPT, content: [...content, ...retryNote], tool: SAVE_CARD_TOOL });
      const parsed = cardSchema.safeParse(input);
      if (parsed.success) return parsed.data;
      lastProblem = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
      lastProblem = error.message;
    }
    console.warn("[card] attempt failed", { attempt, source: extracted.source, problem: lastProblem });
  }
  throw new Error(`card failed validation twice: ${lastProblem}`);
}
