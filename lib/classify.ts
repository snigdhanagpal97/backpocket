// Pure helpers for reading an incoming WhatsApp text. No network calls here.

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»”’]+$/;

// Share-link parameters that only track the click (and, for rcm/mdxt, who shared it).
const TRACKING_PARAMS = /^(utm_.+|rcm|mdxt|igsh|igshid|si|fbclid|gclid|trk|trackingid|lipi|ref_src|mibextid|xtok|highlightedupdate.+)$/i;

/** Drops tracking parameters, so the same post saved twice is one link. */
export function cleanUrl(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  }
  parsed.hash = "";
  return parsed.toString();
}

/** First link in the text, cleaned, with trailing punctuation removed and a scheme added if missing. */
export function findUrl(text: string): string | null {
  const match = text.match(URL_PATTERN);
  if (!match) return null;
  const raw = match[0].replace(TRAILING_PUNCTUATION, "");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return cleanUrl(withScheme);
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

/**
 * LinkedIn's public embed page for a post, built from the activity id in a
 * /posts/...-activity-123 or /feed/update/urn:li:activity:123 link.
 */
export function linkedInEmbedUrl(url: string): string | null {
  const match = url.match(/urn:li:(activity|share|ugcPost):(\d{10,})/) ?? url.match(/-(activity)-(\d{10,})/);
  if (!match) return null;
  return `https://www.linkedin.com/embed/feed/update/urn:li:${match[1]}:${match[2]}`;
}

/** A short reply with no link, like "hi" or "show me", that carries nothing to save. */
export function isBareReply(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length <= 25 && !URL_PATTERN.test(trimmed);
}
