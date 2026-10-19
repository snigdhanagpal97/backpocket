// Saved job posts: spotting the ones you've applied to from confirmation
// emails, and choosing which to remind you about.

import type Anthropic from "@anthropic-ai/sdk";
import { callTool, ToolCallError } from "@/lib/claude";
import { applicationMatchSchema, type ApplicationEmail, type OpenJob } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export const MATCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "match_applications",
  description: "Pair saved job posts with the emails confirming an application to them.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["matches"],
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item_id", "email_id"],
          properties: { item_id: { type: "string" }, email_id: { type: "string" } },
        },
      },
    },
  },
};

const MATCH_PROMPT = `You check whether someone has applied to jobs they saved. You get their saved job posts and recent emails that might confirm an application.

Pair a job with an email only when the email confirms an application was submitted ("thanks for applying", "we received your application") and it is clearly the same company. If the email names a role, it must be the same role or close to it; if it names no role, the company match is enough.

Do not pair rejections, interview invites, job alerts, newsletters or recruiter outreach: they don't prove this application was sent. When unsure, leave it out. Most days nothing matches.

Always answer by calling the match_applications tool.`;

function jobLine(job: OpenJob): string {
  return `id: ${job.id}\ncompany: ${job.job_company ?? "?"}\nrole: ${job.job_role ?? job.title ?? "?"}\nsaved: ${job.created_at.slice(0, 10)}`;
}

function emailLine(email: ApplicationEmail): string {
  return `id: ${email.id}\nfrom: ${email.from}\nsubject: ${email.subject}\ndate: ${email.date.slice(0, 10)}\nsnippet: ${email.snippet.slice(0, 400)}`;
}

/**
 * Which saved jobs these emails confirm an application to. Each job and each
 * email is used at most once. Returns [] when there's nothing to check.
 */
export async function matchConfirmations(
  jobs: OpenJob[],
  emails: ApplicationEmail[],
): Promise<{ job: OpenJob; email: ApplicationEmail }[]> {
  if (jobs.length === 0 || emails.length === 0) return [];
  const prompt = `Saved job posts:\n\n${jobs.map(jobLine).join("\n\n")}\n\nEmails:\n\n${emails.map(emailLine).join("\n\n")}`;

  let input: unknown = null;
  for (let attempt = 1; attempt <= 2 && input === null; attempt++) {
    try {
      const raw = await callTool({ system: MATCH_PROMPT, content: [{ type: "text", text: prompt }], tool: MATCH_TOOL });
      if (applicationMatchSchema.safeParse(raw).success) input = raw;
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
      console.warn("[applications] match attempt failed", { attempt, error: error.message });
    }
  }
  if (input === null) throw new Error("application matching failed twice");

  return validMatches(applicationMatchSchema.parse(input).matches, jobs, emails);
}

/** Drops ids Claude made up and any job or email used twice. */
export function validMatches(
  matches: { item_id: string; email_id: string }[],
  jobs: OpenJob[],
  emails: ApplicationEmail[],
): { job: OpenJob; email: ApplicationEmail }[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const emailsById = new Map(emails.map((email) => [email.id, email]));
  const usedJobs = new Set<string>();
  const usedEmails = new Set<string>();
  const result: { job: OpenJob; email: ApplicationEmail }[] = [];
  for (const { item_id, email_id } of matches) {
    const job = jobsById.get(item_id);
    const email = emailsById.get(email_id);
    if (!job || !email || usedJobs.has(item_id) || usedEmails.has(email_id)) continue;
    usedJobs.add(item_id);
    usedEmails.add(email_id);
    result.push({ job, email });
  }
  return result;
}

/** Days from `today` (YYYY-MM-DD) to a deadline. Negative once it has passed. */
export function daysUntil(deadline: string, today: string): number {
  return Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/**
 * Which open job posts to remind about today, most urgent first:
 * deadlines in the next week, then the ones saved longest ago.
 * A post is skipped if it was saved in the last day, its deadline passed,
 * or it was mentioned in the last 3 days (unless it closes within 2).
 */
export function pickReminders(jobs: OpenJob[], today: string, now: Date, max = 3): OpenJob[] {
  const eligible = jobs.filter((job) => {
    const age = now.getTime() - Date.parse(job.created_at);
    if (age < DAY_MS) return false;
    const days = job.job_deadline ? daysUntil(job.job_deadline, today) : null;
    if (days !== null && days < 0) return false;
    const urgent = days !== null && days <= 2;
    const recentlyReminded = job.last_reminded_at && now.getTime() - Date.parse(job.last_reminded_at) < 3 * DAY_MS - 3600_000;
    return urgent || !recentlyReminded;
  });

  const deadlineSoon = (job: OpenJob) =>
    job.job_deadline !== null && daysUntil(job.job_deadline, today) <= 7 ? daysUntil(job.job_deadline, today) : null;

  return eligible
    .sort((a, b) => {
      const da = deadlineSoon(a);
      const db = deadlineSoon(b);
      if (da !== null || db !== null) return (da ?? Infinity) - (db ?? Infinity);
      return Date.parse(a.created_at) - Date.parse(b.created_at);
    })
    .slice(0, max);
}
