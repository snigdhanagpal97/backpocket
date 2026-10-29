// Checks that a screenshot really shows the walled link it's about to complete.
// Without this, any screenshot sent within 10 minutes of a walled link was
// merged into it, so a batch of saves could put one item's content under
// another item's link.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callTool, ToolCallError } from "@/lib/claude";

/** What a screenshot of this link should look like, from the URL alone. */
export function expectedContent(url: string | null): string {
  if (!url) return "a post or page";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "a post or page";
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (host.endsWith("linkedin.com") || host.endsWith("lnkd.in")) {
    if (path.startsWith("/jobs/")) return "a LinkedIn job listing";
    if (path.startsWith("/in/")) return "a LinkedIn profile";
    return "a LinkedIn post";
  }
  if (host.endsWith("instagram.com") || host.endsWith("instagr.am")) {
    if (path.startsWith("/reel")) return "an Instagram reel (often its caption or a frame of the video)";
    return "an Instagram post";
  }
  return `a page from ${host.replace(/^www\./, "")}`;
}

export const MATCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "check_screenshot",
  description: "Say whether this screenshot shows the saved link.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["matches"],
    properties: {
      matches: { type: "boolean", description: "True only if the image plausibly shows the saved link." },
    },
  },
};

const PROMPT = `Someone saved a link, but the site hid its content, so they were asked to send a screenshot of it. They then sent the image below. Did they send a screenshot of that link, or something else?

Answer true only if the image plausibly shows the expected kind of content and nothing in it contradicts the link (a different company, person or topic named in the link). Answer false if it's clearly something else: a chat, notes, a slide, a different kind of post, or content that doesn't fit the link. When the link gives no detail, judge by whether the image looks like the expected kind of content.

Always answer by calling the check_screenshot tool.`;

const answerSchema = z.object({ matches: z.boolean() });

/**
 * True if the screenshot shows the walled link. Any doubt or error counts as
 * no: saving the screenshot on its own is a smaller mistake than merging it
 * into the wrong item.
 */
export async function screenshotMatchesLink(options: {
  url: string | null;
  linkText: string | null;
  imageBase64: string;
  mimeType: string;
}): Promise<boolean> {
  const text = [
    `Saved link: ${options.url ?? "(none)"}`,
    `Expected: ${expectedContent(options.url)}`,
    options.linkText ? `What the page showed before it hid the rest:\n${options.linkText.slice(0, 1500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const input = await callTool({
      system: PROMPT,
      maxTokens: 500,
      tool: MATCH_TOOL,
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: options.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: options.imageBase64,
          },
        },
        { type: "text", text },
      ],
    });
    const parsed = answerSchema.safeParse(input);
    return parsed.success && parsed.data.matches;
  } catch (error) {
    if (!(error instanceof ToolCallError)) throw error;
    console.warn("[fallback-match] no answer, saving the screenshot on its own", { url: options.url, error: error.message });
    return false;
  }
}
