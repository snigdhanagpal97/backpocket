import { classifyUrl, isQuestion, linkedInEmbedUrl, splitLinkAndNote, type LinkPlatform } from "@/lib/classify";
import { uploadScreenshot } from "@/lib/db";
import { pageToText, parsePage, usefulTextLength, type ParsedPage } from "@/lib/parse-html";
import type { ExtractedContent, WhatsAppMessage } from "@/lib/types";
import { downloadMedia } from "@/lib/whatsapp";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_CHARS = 3_000_000;
const MIN_USEFUL_CHARS = 80;

export class UnsupportedMessageError extends Error {
  constructor(public readonly messageType: string) {
    super(`unsupported message type: ${messageType}`);
  }
}

export async function extractContent(message: WhatsAppMessage): Promise<ExtractedContent> {
  if (message.type === "image" && message.image) return extractImage(message, message.image);
  if (message.type === "text" && message.text) return extractText(message.text.body);
  throw new UnsupportedMessageError(message.type);
}

async function extractImage(
  message: WhatsAppMessage,
  image: NonNullable<WhatsAppMessage["image"]>,
): Promise<ExtractedContent> {
  const media = await downloadMedia(image.id);
  const imagePath = `${message.from}/${message.id}`;
  await uploadScreenshot(imagePath, media.data, media.mimeType);

  const caption = image.caption?.trim() || null;
  return {
    source: "screenshot",
    url: null,
    rawText: caption ?? "",
    userNote: caption,
    imageBase64: media.data.toString("base64"),
    mimeType: media.mimeType,
    imagePath,
    status: "complete",
  };
}

async function extractText(body: string): Promise<ExtractedContent> {
  const { url, note } = splitLinkAndNote(body);

  if (!url) {
    const text = body.trim();
    return {
      source: isQuestion(text) ? "query" : "note",
      url: null,
      rawText: text,
      userNote: null,
      status: "complete",
    };
  }

  return extractLink(url, note);
}

type FetchedPage = { html: string; finalUrl: string };

async function fetchPage(url: string): Promise<FetchedPage | { error: string }> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };

    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|xml/i.test(contentType)) return { error: `not a web page (${contentType || "unknown type"})` };

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    return { html, finalUrl: response.url || url };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return { error: "timed out" };
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

type ReadPage = { page: ParsedPage; text: string; finalPlatform: LinkPlatform };

async function readPage(url: string, platform: LinkPlatform): Promise<ReadPage | { error: string }> {
  const fetched = await fetchPage(url);
  if ("error" in fetched) return fetched;
  // A short link (lnkd.in) can land on linkedin.com, so classify the final URL too.
  const finalPlatform = platform === "web" ? classifyUrl(fetched.finalUrl) : platform;
  const page = parsePage(fetched.html, fetched.finalUrl);
  return { page, text: pageToText(page, { includeBody: finalPlatform === "web" }), finalPlatform };
}

function isEnough(read: ReadPage): boolean {
  return !read.page.isLoginWall && usefulTextLength(read.text) >= MIN_USEFUL_CHARS;
}

export async function extractLink(url: string, note: string | null): Promise<ExtractedContent> {
  const platform: LinkPlatform = classifyUrl(url);
  let read = await readPage(url, platform);

  // LinkedIn's public embed page often shows a post that the post page hides behind sign-up.
  const embedUrl = platform === "linkedin" ? linkedInEmbedUrl(url) : null;
  if (embedUrl && ("error" in read || !isEnough(read))) {
    const embed = await readPage(embedUrl, "linkedin");
    if (!("error" in embed) && isEnough(embed)) read = embed;
  }

  if ("error" in read) {
    console.warn("[extract] could not read link", { url, reason: read.error });
    return linkResult(url, note, platform, "", "needs_fallback");
  }

  const { page, text, finalPlatform } = read;
  const source = finalPlatform === "web" ? (page.recipe ? "recipe_web" : "web") : finalPlatform;
  return linkResult(url, note, source, text, isEnough(read) ? "complete" : "needs_fallback");
}

function linkResult(
  url: string,
  note: string | null,
  source: ExtractedContent["source"],
  pageText: string,
  status: ExtractedContent["status"],
): ExtractedContent {
  const parts = [`Link: ${url}`, pageText, note ? `User note: ${note}` : ""].filter(Boolean);
  return { source, url, rawText: parts.join("\n\n"), userNote: note, status };
}
