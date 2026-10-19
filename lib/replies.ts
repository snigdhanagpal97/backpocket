// Every WhatsApp reply Backpocket sends, as pure functions.

import type { Card, Source } from "@/lib/types";

export const MAX_REPLY_CHARS = 700;

export const SAVE_FAILED = "Couldn't save that one, try again?";
export const UNSUPPORTED = "I can save links, screenshots and text for now.";

export const SAVED_REPLIES = [
  "Got it 🙂",
  "Saved 🙂",
  "Tucked away 🙂",
  "In your back pocket 🙂",
  "Got it, it's safe with me 🙂",
] as const;

/** Picks the same warm reply for the same title, so it varies across saves but is testable. */
function pick<T>(options: readonly T[], seed: string): T {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return options[hash % options.length];
}

export function savedReply(card: Pick<Card, "title">): string {
  return pick(SAVED_REPLIES, card.title);
}

export function alreadySavedReply(): string {
  return "Already have that one 🙂";
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
function packMessages(blocks: string[], max: number): string[] {
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
