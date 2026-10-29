// Pure HTML parsing for saved links. Takes HTML we already fetched; never fetches.

import * as cheerio from "cheerio";

export type Recipe = {
  name: string | null;
  description: string | null;
  ingredients: string[];
  instructions: string[];
};

export type ParsedPage = {
  title: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  description: string | null;
  recipe: Recipe | null;
  /** Readable paragraph text from the page body, capped. */
  bodyText: string;
  /** The full text of a LinkedIn post, which og:description cuts short. */
  postText: string | null;
  isLoginWall: boolean;
};

const MAX_BODY_TEXT = 6000;

/** Strips tags and decodes entities, then collapses whitespace. */
function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.includes("<") || value.includes("&") ? cheerio.load(value).text() : value;
  return text.replace(/\s+/g, " ").trim();
}

function orNull(value: string): string | null {
  return value ? value : null;
}

// ---------- JSON-LD ----------

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasType(node: JsonObject, type: string): boolean {
  const value = node["@type"];
  if (typeof value === "string") return value === type;
  return Array.isArray(value) && value.includes(type);
}

/** Walks arrays and @graph containers and returns every JSON-LD object node. */
export function flattenJsonLd(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!isObject(value)) return [];
  const graph = value["@graph"];
  return [value, ...(graph ? flattenJsonLd(graph) : [])];
}

function instructionLines(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap(instructionLines);
  if (!isObject(value)) return [];

  if (hasType(value, "HowToSection")) {
    const steps = instructionLines(value.itemListElement);
    const name = cleanText(value.name);
    return name ? [`${name}:`, ...steps] : steps;
  }
  const text = cleanText(value.text) || cleanText(value.name);
  return text ? [text] : [];
}

export function recipeFromJsonLd(blocks: unknown[]): Recipe | null {
  const node = blocks.flatMap(flattenJsonLd).find((item) => hasType(item, "Recipe"));
  if (!node) return null;

  const ingredientsSource = node.recipeIngredient ?? node.ingredients;
  const ingredients = (Array.isArray(ingredientsSource) ? ingredientsSource : [ingredientsSource])
    .map(cleanText)
    .filter(Boolean);

  return {
    name: orNull(cleanText(node.name)),
    description: orNull(cleanText(node.description)),
    ingredients,
    instructions: instructionLines(node.recipeInstructions),
  };
}

export function recipeToText(recipe: Recipe): string {
  const lines: string[] = [];
  if (recipe.name) lines.push(`Recipe: ${recipe.name}`);
  if (recipe.description) lines.push(recipe.description);
  if (recipe.ingredients.length) {
    lines.push("Ingredients:", ...recipe.ingredients.map((item) => `- ${item}`));
  }
  if (recipe.instructions.length) {
    lines.push("Instructions:", ...recipe.instructions.map((step, i) => `${i + 1}. ${step}`));
  }
  return lines.join("\n");
}

function readJsonLdBlocks($: cheerio.CheerioAPI): unknown[] {
  const blocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element)
      .text()
      .replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "")
      .trim();
    if (!raw) return;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Some sites ship broken JSON-LD. Skip that block, keep the rest.
    }
  });
  return blocks;
}

// ---------- Login walls ----------

const WALL_PATHS = /^\/(authwall|login|signup|uas\/login|checkpoint|accounts\/login|accounts\/signup)\b/i;
const WALL_TITLES = [
  /^sign up \| linkedin$/i,
  /^linkedin login/i,
  /^log ?in or sign up/i,
  /^log ?in • instagram$/i,
  /^sign ?in \| linkedin$/i,
];

export function looksLikeLoginWall(input: {
  finalUrl: string;
  title: string | null;
  pageKey: string | null;
}): boolean {
  try {
    if (WALL_PATHS.test(new URL(input.finalUrl).pathname)) return true;
  } catch {
    // Not a URL; fall through to the other checks.
  }
  if (input.title && WALL_TITLES.some((pattern) => pattern.test(input.title!.trim()))) return true;
  if (input.pageKey && /authwall|registration|login/i.test(input.pageKey)) return true;
  return false;
}

// ---------- Page ----------

function readLinkedInPostText($: cheerio.CheerioAPI): string | null {
  // The post itself, on both the public post page and the embed page. Comments share the class but not the test id.
  const post = $('[data-test-id^="main-feed-activity-"][data-test-id$="__commentary"]').first();
  // Public job pages keep the full description in this block.
  const job = post.length ? post : $(".show-more-less-html__markup, .description__text").first();
  // LinkedIn double-encodes ampersands, so one decode leaves "amp;" behind.
  const text = job.length ? job.text().replace(/&amp;|\bamp;/g, "&") : "";
  return orNull(text.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim());
}

function readBodyText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, nav, header, footer, aside, form").remove();
  const container = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("body");

  const paragraphs = container
    .find("p, li, h1, h2, h3")
    .map((_, element) => cleanText($(element).text()))
    .get()
    .filter((text) => text.length > 1);

  const unique = [...new Set(paragraphs)].join("\n");
  return unique.length > MAX_BODY_TEXT ? `${unique.slice(0, MAX_BODY_TEXT)}…` : unique;
}

export function parsePage(html: string, finalUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const meta = (selector: string) => orNull(cleanText($(selector).first().attr("content")));

  const title = orNull(cleanText($("title").first().text()));
  const recipe = recipeFromJsonLd(readJsonLdBlocks($));
  const isLoginWall = looksLikeLoginWall({
    finalUrl,
    title,
    pageKey: meta('meta[name="pageKey"]'),
  });

  const postText = isLoginWall ? null : readLinkedInPostText($);

  return {
    title,
    postText,
    ogTitle: meta('meta[property="og:title"]'),
    ogDescription: meta('meta[property="og:description"]'),
    description: meta('meta[name="description"]'),
    recipe,
    bodyText: isLoginWall ? "" : readBodyText($),
    isLoginWall,
  };
}

/**
 * The text worth handing to the card builder, labeled. A login wall yields
 * nothing, because its title and description describe the wall, not the post.
 */
export function pageToText(page: ParsedPage, options: { includeBody: boolean }): string {
  if (page.isLoginWall) return "";

  const sections: string[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: string | null) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    sections.push(`${label}: ${value}`);
  };

  add("Title", page.ogTitle ?? page.title);
  if (page.postText) {
    // The description is a truncated copy of the post; the full text replaces it.
    sections.push(`Post text:\n${page.postText}`);
  } else {
    add("Description", page.ogDescription);
    add("Description", page.description);
  }
  if (page.recipe) sections.push(recipeToText(page.recipe));
  if (options.includeBody && page.bodyText) sections.push(`Page text:\n${page.bodyText}`);

  return sections.join("\n\n");
}

/** Length of the readable content, ignoring our own section labels. */
export function usefulTextLength(text: string): number {
  return text
    .replace(/^(Title|Description|Page text|Post text|Recipe|Ingredients|Instructions):\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim().length;
}
