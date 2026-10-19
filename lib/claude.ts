import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

export const CLAUDE_MODEL = "claude-sonnet-5-5";

let client: Anthropic | undefined;

function claude(): Anthropic {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, timeout: 40_000 });
  return client;
}

export class ToolCallError extends Error {}

/**
 * Asks Claude to answer through a single strict tool and returns the raw tool
 * input. Sonnet 5.5 doesn't accept forced tool_choice, so the prompt asks for
 * the tool and we treat a missing call as a failure the caller can retry.
 */
export async function callTool(options: {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  tool: Anthropic.Beta.BetaTool;
  maxTokens?: number;
}): Promise<unknown> {
  const response = await claude().beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: options.maxTokens ?? 4000,
    // If Sonnet declines on policy grounds, retry server-side on the default fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Extraction and picking, not deep reasoning: keep it quick for the webhook.
    output_config: { effort: "low" },
    system: options.system,
    tools: [{ ...options.tool, strict: true }],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: options.content }],
  });

  if (response.stop_reason === "refusal") {
    throw new ToolCallError(`Claude declined (${response.stop_details?.category ?? "no category"})`);
  }
  const call = response.content.find(
    (block): block is Anthropic.Beta.BetaToolUseBlock =>
      block.type === "tool_use" && block.name === options.tool.name,
  );
  if (!call) throw new ToolCallError(`Claude did not call ${options.tool.name} (stop: ${response.stop_reason})`);
  return call.input;
}
