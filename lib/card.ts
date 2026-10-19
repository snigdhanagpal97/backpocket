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
    required: ["item_type", "title", "summary", "key_points", "entities", "topics", "image_text", "job"],
    properties: {
      item_type: { type: "string", enum: [...ITEM_TYPES] },
      title: { type: "string", description: "Short, specific title. 60 characters or fewer." },
      summary: {
        type: "string",
        description: "What the content says, in one or two sentences and at most 30 words.",
      },
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
      image_text: {
        type: "string",
        description:
          "All readable text in the image, close to verbatim, with who said what for chats. Empty string if there is no image.",
      },
      job: {
        type: "object",
        additionalProperties: false,
        required: ["company", "role", "deadline"],
        description: "Only for item_type job. Empty strings for everything else.",
        properties: {
          company: { type: "string", description: "The hiring company, as its name would appear in a confirmation email." },
          role: { type: "string", description: 'The role, like "Product Management Intern, Summer 2027".' },
          deadline: {
            type: "string",
            description: "Application deadline as YYYY-MM-DD, only if the content states one. Otherwise empty.",
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You turn something a person saved (a web page, a social post, a screenshot or a note) into a card they can find later.

Use only the content you are given: the page text, the image, the link and the person's own note. Never invent details. Do not add ingredients, steps, numbers, names or claims that are not in the content. If the content is thin, keep the card short and leave key_points empty rather than guessing.

item_type: recipe for anything with ingredients or cooking steps, how_to for instructions or tips, job for a posting of a specific open job or internship someone could apply to (including a social post announcing one), post for other social posts and articles, note for the person's own thoughts, other for everything else. A post with career advice or about a company in general is a post, not a job.

For a job, fill job with the company, the role and the deadline if one is stated. Resolve a deadline without a year using today's date. Leave job fields empty for every other type.

The summary is one or two sentences and at most 30 words: the point of the content, with the specifics that matter (names, numbers, dates, pay). Write about what the content says, not about the medium or the format. Bad: "Screenshot of a chat where Aditi gives feedback on a framework." Good: "Aditi said the framework is good, the sheet should be neater, and the key question belongs at the top." Key points carry the actual statements, attributed to the person who made them when that's clear.

For an image, also copy its readable text into image_text, close to verbatim. For chats, keep who said what.

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
    `Today: ${new Date().toISOString().slice(0, 10)}`,
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
