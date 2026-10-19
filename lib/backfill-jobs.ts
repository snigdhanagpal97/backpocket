// One-off: finds job posts among items saved before job detection existed.

import type Anthropic from "@anthropic-ai/sdk";
import { callTool, ToolCallError } from "@/lib/claude";
import { itemsToCheckForJobs, setJobFields } from "@/lib/db";
import { jobCheckSchema } from "@/lib/types";

const BATCH = 20;

export const JOB_CHECK_TOOL: Anthropic.Beta.BetaTool = {
  name: "report_jobs",
  description: "List the saved items that are postings for a specific job or internship.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["jobs"],
    properties: {
      jobs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item_id", "company", "role", "deadline"],
          properties: {
            item_id: { type: "string" },
            company: { type: "string" },
            role: { type: "string" },
            deadline: { type: "string", description: "YYYY-MM-DD if the item states one, otherwise empty." },
          },
        },
      },
    },
  },
};

const PROMPT = `You get items someone saved. Report the ones that are a posting for a specific open job or internship they could apply to, including a social post announcing one. Career advice, interview tips and posts about a company in general are not jobs.

For each job give the hiring company, the role, and the deadline only if the item states one (resolve a missing year from the date it was saved). Use only what the item says.

Always answer by calling the report_jobs tool.`;

/** Checks the next batch after `afterId`. Returns the id to continue from, or null when done. */
export async function backfillJobs(
  phone: string,
  afterId: string | null,
): Promise<{ checked: number; jobs: number; next: string | null }> {
  const items = await itemsToCheckForJobs(phone, afterId, BATCH);
  if (items.length === 0) return { checked: 0, jobs: 0, next: null };

  const prompt = items
    .map((item) =>
      [
        `id: ${item.id}`,
        `saved: ${item.created_at.slice(0, 10)}`,
        `title: ${item.title ?? ""}`,
        `summary: ${item.summary ?? ""}`,
        `text: ${(item.raw_text ?? "").slice(0, 800)}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  let jobs: ReturnType<typeof jobCheckSchema.parse>["jobs"] | null = null;
  for (let attempt = 1; attempt <= 2 && !jobs; attempt++) {
    try {
      const parsed = jobCheckSchema.safeParse(
        await callTool({ system: PROMPT, content: [{ type: "text", text: prompt }], tool: JOB_CHECK_TOOL }),
      );
      if (parsed.success) jobs = parsed.data.jobs;
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
    }
  }
  if (!jobs) throw new Error("job check failed twice");

  const ids = new Set(items.map((item) => item.id));
  const found = jobs.filter((job) => ids.has(job.item_id));
  for (const job of found) await setJobFields(job.item_id, job);
  return { checked: items.length, jobs: found.length, next: items.length < BATCH ? null : items[items.length - 1].id };
}
