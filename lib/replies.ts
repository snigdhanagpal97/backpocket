// Every WhatsApp reply Backpocket sends, as pure functions.

import type { Card, Source } from "@/lib/types";

export const MAX_REPLY_CHARS = 700;

export const SAVE_FAILED = "Couldn't save that one, try again?";
export const UNSUPPORTED = "I can save links, screenshots and text for now.";

/** "✅ Nordstrom Summer 2027 internships: 7 paid roles open": a tick and what was saved, nothing else. */
export function savedReply(card: Pick<Card, "title">): string {
  return `✅ ${card.title}`;
}

export function alreadySavedReply(title: string | null): string {
  return title ? `👍 Already saved: ${title}` : "👍 Already saved that one";
}

const PLATFORM_NAMES: Partial<Record<Source, string>> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
};

export function fallbackReply(source: Source): string {
  const platform = PLATFORM_NAMES[source];
  const who = platform ? `${platform} hid the content` : "I couldn't read that page";
  return `Saved the link, but ${who}. Send a screenshot in the next 10 minutes and I'll attach it.`;
}

/** Trims a reply to WhatsApp-friendly length without cutting mid-word. */
export function clampReply(text: string, max = MAX_REPLY_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).trimEnd()}…`;
}

export const SEARCH_FAILED = "Couldn't search just now, try again?";
export const NOTHING_FOUND = "I couldn't find anything you saved about that.";

export type OutgoingMessage = { text: string; replyTo: string | null };

type AnswerItem = { title: string | null; url: string | null; wa_message_id: string | null };

/**
 * The answer quotes the message you saved the best item with, and ends with
 * its link. Other items that helped follow as short replies quoting theirs,
 * so you can tap back to what you sent. Links are never cut.
 */
export function searchMessages(answer: string, items: AnswerItem[], max = MAX_REPLY_CHARS): OutgoingMessage[] {
  const [top, ...rest] = items;
  if (!top) return [{ text: clampReply(answer, max), replyTo: null }];

  const link = top.url ? `\n\n${top.url}` : "";
  const first = { text: clampReply(answer, max - link.length) + link, replyTo: top.wa_message_id };
  const others = rest.map((item) => {
    const itemLink = item.url ? `\n${item.url}` : "";
    return {
      text: clampReply(`Also from your saves: ${item.title ?? "this one"}`, max - itemLink.length) + itemLink,
      replyTo: item.wa_message_id,
    };
  });
  return [first, ...others];
}

// ---------- lists ----------

export const NOTHING_TO_LIST = "Nothing you saved matches that.";
export const NO_LIST_YET = "Ask me for a list first, then reply with its numbers.";

type ListEntry = { title: string | null; url: string | null; done_label: string | null };

/** Splits blocks into messages under the limit, keeping each block whole. */
export function packMessages(blocks: string[], max: number): string[] {
  const messages: string[] = [];
  let current = "";
  for (const block of blocks) {
    const piece = clampReply(block, max);
    if (current && current.length + 2 + piece.length > max) {
      messages.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) messages.push(current);
  return messages;
}

/**
 * A numbered list of saved items, then a prompt to reply with the numbers
 * they acted on. Long lists continue across messages; numbering never restarts.
 */
export function listMessages(
  heading: string,
  entries: ListEntry[],
  hidden: { count: number; label: string } | null,
  max = MAX_REPLY_CHARS,
): OutgoingMessage[] {
  const blocks = [heading || "Here's what you saved:"];
  entries.forEach((entry, i) => {
    const done = entry.done_label ? ` (${entry.done_label})` : "";
    blocks.push(`${i + 1}. ${entry.title ?? "Untitled"}${done}${entry.url ? `\n${entry.url}` : ""}`);
  });
  const footer = [
    hidden && hidden.count > 0
      ? `Leaving out ${hidden.count} you already marked ${hidden.label}.`
      : "",
    "Applied to or done with any? Reply with the numbers, like 1, 3.",
  ]
    .filter(Boolean)
    .join("\n");
  blocks.push(footer);
  return packMessages(blocks, max).map((text) => ({ text, replyTo: null }));
}

export function allDoneReply(count: number, label: string): string {
  return count === 1
    ? `The one match is already marked ${label}.`
    : `All ${count} matches are already marked ${label}. Ask for them "including ones I applied to" to see them.`;
}

export function markDoneReply(
  label: string | null,
  titles: string[],
  problems: { badNumbers: number[]; unmatched: string[] },
): string {
  const lines: string[] = [];
  if (titles.length > 0) {
    lines.push(label ? `Marked ${label}:` : "Moved back to your lists:");
    lines.push(...titles.map((title) => `- ${title}`));
    if (label) lines.push(`I'll leave ${titles.length === 1 ? "it" : "them"} out of future lists.`);
  }
  if (problems.badNumbers.length > 0) {
    lines.push(`The last list didn't have ${problems.badNumbers.join(", ")}.`);
  }
  if (problems.unmatched.length > 0) {
    lines.push(`I couldn't find ${problems.unmatched.join(", ")} in the last list. Ask for the list again and reply with numbers.`);
  }
  return clampReply(lines.join("\n") || NO_LIST_YET);
}

// ---------- morning brief ----------

export const NO_PENDING_BRIEF = "Nothing waiting right now. Your next brief comes tomorrow morning.";

export type BriefPrep = {
  start: string;
  title: string;
  items: { id: string; title: string | null; url: string | null; note: string }[];
};

export type BriefReminder = {
  title: string | null;
  url: string | null;
  job_company: string | null;
  job_role: string | null;
  job_deadline: string | null;
  created_at: string;
};

export type BriefInput = {
  today: string;
  timeZone: string;
  prep: BriefPrep[];
  reminders: BriefReminder[];
  /** Jobs just marked applied from a confirmation email. */
  applied: { title: string | null; job_company: string | null }[];
};

function timeOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "PM Intern, Nordstrom" without repeating the company if the role already names it. */
export function jobLabel(job: Pick<BriefReminder, "title" | "job_company" | "job_role">): string {
  const role = job.job_role || job.title || "Untitled";
  const company = job.job_company;
  return company && !role.toLowerCase().includes(company.toLowerCase()) ? `${role}, ${company}` : role;
}

/** "closes today", "closes Fri", "closes Nov 14", or how long ago it was saved. */
export function jobTiming(job: Pick<BriefReminder, "job_deadline" | "created_at">, today: string): string {
  const dayMs = 24 * 60 * 60 * 1000;
  if (job.job_deadline) {
    const days = Math.round((Date.parse(`${job.job_deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
    const date = new Date(`${job.job_deadline}T12:00:00Z`);
    if (days <= 0) return "closes today";
    if (days === 1) return "closes tomorrow";
    if (days < 7) return `closes ${new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date)}`;
    return `closes ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date)}`;
  }
  // Calendar days, the way people count "saved 3 days ago".
  const saved = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${job.created_at.slice(0, 10)}T00:00:00Z`)) / dayMs);
  return saved >= 2 ? `saved ${saved} days ago` : saved === 1 ? "saved yesterday" : "saved today";
}

/**
 * The morning brief: applications found in email, then prep for today's
 * meetings, then posts still waiting for an application (numbered, so a reply
 * of "1, 3" marks them). Empty when there's nothing worth a message.
 */
export function briefMessages(input: BriefInput, max = MAX_REPLY_CHARS): OutgoingMessage[] {
  const blocks: string[] = [];

  if (input.applied.length > 0) {
    const names = input.applied.map((job) => job.job_company || job.title || "one post");
    blocks.push(`Saw your application email for ${joinNames(names)}, so I marked ${input.applied.length === 1 ? "it" : "them"} applied.`);
  }

  const prep = input.prep.filter((event) => event.items.length > 0);
  if (prep.length > 0) {
    blocks.push("For today:");
    for (const event of prep) {
      const lines = [`${timeOf(event.start, input.timeZone)} ${event.title}`];
      for (const item of event.items) {
        lines.push(`- ${item.note || item.title || "Something you saved"}${item.url ? `\n${item.url}` : ""}`);
      }
      blocks.push(lines.join("\n"));
    }
  }

  if (input.reminders.length > 0) {
    blocks.push("Still to apply:");
    input.reminders.forEach((job, i) => {
      blocks.push(`${i + 1}. ${jobLabel(job)} (${jobTiming(job, input.today)})${job.url ? `\n${job.url}` : ""}`);
    });
    blocks.push('Applied to any? Reply with the numbers, like 1, 2. Not going for one? Say "skip 2".');
  }

  if (blocks.length === 0) return [];
  return packMessages(blocks, max).map((text) => ({ text, replyTo: null }));
}
