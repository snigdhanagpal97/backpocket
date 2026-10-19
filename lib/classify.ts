// Pure helpers for reading an incoming WhatsApp text. No network calls here.

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»”’]+$/;

/** First link in the text, with trailing punctuation removed and a scheme added if missing. */
export function findUrl(text: string): string | null {
  const match = text.match(URL_PATTERN);
  if (!match) return null;
  const raw = match[0].replace(TRAILING_PUNCTUATION, "");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

/** Splits a message into its first link and whatever else the user typed. */
export function splitLinkAndNote(text: string): { url: string | null; note: string | null } {
  const match = text.match(URL_PATTERN);
  const url = findUrl(text);
  if (!match || !url) return { url: null, note: text.trim() || null };
  const note = text.replace(match[0], " ").replace(/\s+/g, " ").trim();
  return { url, note: note || null };
}

function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export type LinkPlatform = "linkedin" | "instagram" | "web";

export function classifyUrl(url: string): LinkPlatform {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "web";
  }
  if (hostMatches(host, ["linkedin.com", "lnkd.in"])) return "linkedin";
  if (hostMatches(host, ["instagram.com", "instagr.am"])) return "instagram";
  return "web";
}

const QUESTION_STARTERS = /^(find|what|where|show|which|how|do i have|any)\b/i;

/** True when a plain-text message reads like a search rather than a note to save. */
export function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith("?") || QUESTION_STARTERS.test(trimmed);
}
