// Every WhatsApp reply Backpocket sends, as pure functions.

import type { Card, Source } from "@/lib/types";

export const MAX_REPLY_CHARS = 700;

export const SAVE_FAILED = "Couldn't save that one, try again?";
export const UNSUPPORTED = "I can save links, screenshots and text for now.";

export function savedReply(card: Pick<Card, "title" | "item_type" | "topics">): string {
  const type = card.item_type.replace(/_/g, "-");
  const tags = card.topics.map((topic) => `#${topic}`).join(" ");
  return `Saved: ${card.title}\n${type} · ${tags}`;
}

export function alreadySavedReply(title: string | null): string {
  return title ? `Already saved: ${title}` : "Already saved that one.";
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
