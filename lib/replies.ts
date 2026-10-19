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

type ReplyPick = { item: { title: string | null; url: string | null }; why: string };

function pickBlock(pick: ReplyPick, whyLimit: number): string {
  const why = pick.why.length > whyLimit ? `${pick.why.slice(0, whyLimit - 1).trimEnd()}…` : pick.why;
  return [pick.item.title ?? "Untitled", why, pick.item.url ?? ""].filter(Boolean).join("\n");
}

/**
 * Each pick as title, one line on why, and its link. Stays under the reply
 * limit by shortening the why lines, then dropping the last pick; links are
 * never cut, because a cut link doesn't open.
 */
export function searchReply(picks: ReplyPick[], max = MAX_REPLY_CHARS): string {
  for (let count = picks.length; count > 0; count--) {
    for (const whyLimit of [Infinity, 90, 50]) {
      const text = picks
        .slice(0, count)
        .map((pick) => pickBlock(pick, whyLimit))
        .join("\n\n");
      if (text.length <= max) return text;
    }
  }
  return clampReply(pickBlock(picks[0], 50), max);
}
