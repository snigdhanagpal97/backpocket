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
