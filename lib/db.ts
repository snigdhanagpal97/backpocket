import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MatchedItem, OpenJob, SearchItem } from "@/lib/types";
import { env } from "@/lib/env";

export const SCREENSHOT_BUCKET = "screenshots";

let client: SupabaseClient | undefined;

/** Server-only Supabase client using the service role key. */
export function db(): SupabaseClient {
  client ??= createClient(env().SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Stores a screenshot. Upserts, so a retried webhook doesn't fail on the second upload. */
export async function uploadScreenshot(path: string, data: Buffer, contentType: string): Promise<void> {
  const { error } = await db()
    .storage.from(SCREENSHOT_BUCKET)
    .upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`screenshot upload to ${path} failed: ${error.message}`);
}

// ---------- items ----------

export type ItemRow = {
  id: string;
  user_phone: string;
  source: string;
  url: string | null;
  raw_text: string | null;
  image_path: string | null;
  item_type: string | null;
  title: string | null;
  summary: string | null;
  key_points: string[];
  topics: string[];
  status: string;
  wa_message_id: string | null;
  created_at: string;
};

export type NewItem = {
  user_phone: string;
  source: string;
  url?: string | null;
  raw_text?: string | null;
  image_path?: string | null;
  item_type?: string | null;
  title?: string | null;
  summary?: string | null;
  key_points?: string[];
  entities?: { people: string[]; companies: string[] };
  topics?: string[];
  job_company?: string | null;
  job_role?: string | null;
  job_deadline?: string | null;
  embedding?: number[] | null;
  status: string;
  wa_message_id: string;
};

const UNIQUE_VIOLATION = "23505";
const ITEM_COLUMNS =
  "id, user_phone, source, url, raw_text, image_path, item_type, title, summary, key_points, topics, status, wa_message_id, created_at";

// pgvector reads its text format, which is the same as a JSON array.
function toVector(embedding: number[] | null | undefined): string | null | undefined {
  return embedding === undefined ? undefined : embedding === null ? null : JSON.stringify(embedding);
}

/** Inserts an item. Returns null if this WhatsApp message was already saved. */
export async function insertItem(item: NewItem): Promise<ItemRow | null> {
  const { data, error } = await db()
    .from("items")
    .insert({ ...item, embedding: toVector(item.embedding) })
    .select(ITEM_COLUMNS)
    .single();
  if (error?.code === UNIQUE_VIOLATION) return null;
  if (error) throw new Error(`insert item failed: ${error.message}`);
  return data as ItemRow;
}

export async function updateItem(
  id: string,
  changes: Omit<Partial<NewItem>, "wa_message_id" | "user_phone">,
): Promise<ItemRow> {
  const { data, error } = await db()
    .from("items")
    .update({ ...changes, embedding: toVector(changes.embedding) })
    .eq("id", id)
    .select(ITEM_COLUMNS)
    .single();
  if (error) throw new Error(`update item ${id} failed: ${error.message}`);
  return data as ItemRow;
}

/**
 * True if this WhatsApp message was already handled: saved as its own item, or
 * attached as the screenshot for an earlier link (then only its image path has the id).
 */
export async function messageAlreadySaved(waMessageId: string, imagePath: string): Promise<boolean> {
  const quoted = (value: string) => `"${value.replace(/"/g, '\\"')}"`;
  const { count, error } = await db()
    .from("items")
    .select("id", { count: "exact", head: true })
    .or(`wa_message_id.eq.${quoted(waMessageId)},image_path.eq.${quoted(imagePath)}`);
  if (error) throw new Error(`dedupe lookup failed: ${error.message}`);
  return (count ?? 0) > 0;
}

/** An earlier save of the same link (or the same note text) by this user. */
export async function findSameContent(
  phone: string,
  match: { url: string } | { note: string },
): Promise<ItemRow | null> {
  let query = db().from("items").select(ITEM_COLUMNS).eq("user_phone", phone);
  query = "url" in match ? query.eq("url", match.url) : query.eq("source", "note").eq("raw_text", match.note);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`duplicate lookup failed: ${error.message}`);
  return data as ItemRow | null;
}

/**
 * The walled link a screenshot should complete: this user's most recent item,
 * if it was created after `since` and is still needs_fallback. Anything saved
 * in between means the screenshot is something new.
 */
export async function findPendingFallback(phone: string, since: Date): Promise<ItemRow | null> {
  const { data, error } = await db()
    .from("items")
    .select(ITEM_COLUMNS)
    .eq("user_phone", phone)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fallback lookup failed: ${error.message}`);
  const latest = data as ItemRow | null;
  return latest?.status === "needs_fallback" ? latest : null;
}

/**
 * Atomically claims a needs_fallback item for one screenshot, so two
 * screenshots arriving together can't both attach to (and overwrite) it.
 * Returns false if another message already claimed it.
 */
export async function claimFallback(id: string): Promise<boolean> {
  const { data, error } = await db()
    .from("items")
    .update({ status: "attaching" })
    .eq("id", id)
    .eq("status", "needs_fallback")
    .select("id");
  if (error) throw new Error(`fallback claim for ${id} failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Puts a claimed item back so a later screenshot can still complete it. */
export async function releaseFallback(id: string): Promise<void> {
  const { error } = await db().from("items").update({ status: "needs_fallback" }).eq("id", id).eq("status", "attaching");
  if (error) console.error("[db] fallback release failed", { id, error: error.message });
}

// ---------- search ----------

export async function matchItems(phone: string, embedding: number[], count: number): Promise<MatchedItem[]> {
  const { data, error } = await db().rpc("match_items", {
    query_embedding: toVector(embedding),
    match_count: count,
    phone,
  });
  if (error) throw new Error(`match_items failed: ${error.message}`);
  return (data ?? []) as MatchedItem[];
}

/** Loads the content search answers from, in the order of `ids`. */
export async function getSearchItems(ids: string[]): Promise<SearchItem[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db()
    .from("items")
    .select("id, title, summary, key_points, raw_text, url, item_type, wa_message_id, done_at, done_label")
    .in("id", ids);
  if (error) throw new Error(`search item lookup failed: ${error.message}`);
  const byId = new Map((data as SearchItem[]).map((item) => [item.id, item]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** Marks items as opened and logs one resurfacing per item. */
export async function recordResurfacing(itemIds: string[], trigger: string): Promise<void> {
  if (itemIds.length === 0) return;
  const now = new Date().toISOString();
  const [opened, logged] = await Promise.all([
    db().from("items").update({ last_opened_at: now }).in("id", itemIds),
    db().from("resurfacings").insert(itemIds.map((item_id) => ({ item_id, trigger, sent_at: now }))),
  ]);
  if (opened.error) throw new Error(`last_opened_at update failed: ${opened.error.message}`);
  if (logged.error) throw new Error(`resurfacings insert failed: ${logged.error.message}`);
}

// ---------- lists and done ----------

export type ChatState = { lastList: string[]; lastListAt: Date | null };

export async function getChatState(phone: string): Promise<ChatState> {
  const { data, error } = await db()
    .from("chat_state")
    .select("last_list, last_list_at")
    .eq("user_phone", phone)
    .maybeSingle();
  if (error) throw new Error(`chat_state lookup failed: ${error.message}`);
  return {
    lastList: Array.isArray(data?.last_list) ? (data.last_list as string[]) : [],
    lastListAt: data?.last_list_at ? new Date(data.last_list_at) : null,
  };
}

export async function saveLastList(phone: string, itemIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db()
    .from("chat_state")
    .upsert({ user_phone: phone, last_list: itemIds, last_list_at: now, updated_at: now });
  if (error) throw new Error(`chat_state save failed: ${error.message}`);
}

/**
 * Marks items done with a label like "applied", or clears that with label null.
 * `source` says who decided: the user replying with numbers, or a confirmation email.
 */
export async function setDone(
  phone: string,
  itemIds: string[],
  label: string | null,
  options: { source?: "user" | "email"; at?: Date } = {},
): Promise<string[]> {
  const changes = label
    ? { done_at: (options.at ?? new Date()).toISOString(), done_label: label, done_source: options.source ?? "user" }
    : { done_at: null, done_label: null, done_source: null };
  const { data, error } = await db()
    .from("items")
    .update(changes)
    .eq("user_phone", phone)
    .in("id", itemIds)
    .select("id, title");
  if (error) throw new Error(`done update failed: ${error.message}`);
  const titles = new Map((data ?? []).map((row) => [row.id as string, (row.title as string | null) ?? "Untitled"]));
  return itemIds.flatMap((id) => titles.get(id) ?? []);
}

// ---------- morning brief ----------

/** Saved job posts with no application yet, newest first. */
export async function openJobs(phone: string, since: Date): Promise<OpenJob[]> {
  const { data, error } = await db()
    .from("items")
    .select("id, title, url, job_company, job_role, job_deadline, created_at, last_reminded_at")
    .eq("user_phone", phone)
    .eq("item_type", "job")
    .eq("status", "complete")
    .is("done_at", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`open jobs lookup failed: ${error.message}`);
  return (data ?? []) as OpenJob[];
}

export async function markReminded(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const { error } = await db().from("items").update({ last_reminded_at: new Date().toISOString() }).in("id", itemIds);
  if (error) throw new Error(`last_reminded_at update failed: ${error.message}`);
}

export type BriefState = { lastBriefDate: string | null };

export async function getBriefState(phone: string): Promise<BriefState> {
  const { data, error } = await db().from("chat_state").select("last_brief_date").eq("user_phone", phone).maybeSingle();
  if (error) throw new Error(`brief state lookup failed: ${error.message}`);
  return { lastBriefDate: (data?.last_brief_date as string | null) ?? null };
}

export async function setBriefSent(phone: string, date: string): Promise<void> {
  const { error } = await db()
    .from("chat_state")
    .upsert({ user_phone: phone, last_brief_date: date, updated_at: new Date().toISOString() });
  if (error) throw new Error(`brief date save failed: ${error.message}`);
}

/** Holds a brief WhatsApp wouldn't deliver, until the user next writes. */
export async function savePendingBrief(phone: string, texts: string[]): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db()
    .from("chat_state")
    .upsert({ user_phone: phone, pending_brief: texts, pending_brief_at: now, updated_at: now });
  if (error) throw new Error(`pending brief save failed: ${error.message}`);
}

/**
 * Takes the held brief, if any and not older than `maxAgeMs`. Only one caller
 * gets it: the clear is conditional on the timestamp that was read.
 */
export async function takePendingBrief(phone: string, maxAgeMs: number): Promise<string[] | null> {
  const { data, error } = await db()
    .from("chat_state")
    .select("pending_brief, pending_brief_at")
    .eq("user_phone", phone)
    .maybeSingle();
  if (error) throw new Error(`pending brief lookup failed: ${error.message}`);
  if (!data?.pending_brief || !data.pending_brief_at) return null;

  const { data: cleared, error: clearError } = await db()
    .from("chat_state")
    .update({ pending_brief: null, pending_brief_at: null })
    .eq("user_phone", phone)
    .eq("pending_brief_at", data.pending_brief_at)
    .select("user_phone");
  if (clearError) throw new Error(`pending brief clear failed: ${clearError.message}`);
  if ((cleared ?? []).length === 0) return null;

  const age = Date.now() - new Date(data.pending_brief_at as string).getTime();
  return age <= maxAgeMs && Array.isArray(data.pending_brief) ? (data.pending_brief as string[]) : null;
}

/** Items saved before job detection existed, for the one-off backfill. */
export async function itemsToCheckForJobs(
  phone: string,
  afterId: string | null,
  limit: number,
): Promise<{ id: string; title: string | null; summary: string | null; raw_text: string | null; created_at: string }[]> {
  let query = db()
    .from("items")
    .select("id, title, summary, raw_text, created_at")
    .eq("user_phone", phone)
    .eq("status", "complete")
    .in("item_type", ["post", "other", "how_to", "note"])
    .order("id", { ascending: true })
    .limit(limit);
  if (afterId) query = query.gt("id", afterId);
  const { data, error } = await query;
  if (error) throw new Error(`backfill lookup failed: ${error.message}`);
  return data ?? [];
}

export async function setJobFields(
  id: string,
  job: { company: string; role: string; deadline: string },
): Promise<void> {
  const { error } = await db()
    .from("items")
    .update({
      item_type: "job",
      job_company: job.company || null,
      job_role: job.role || null,
      job_deadline: job.deadline || null,
    })
    .eq("id", id);
  if (error) throw new Error(`job fields update for ${id} failed: ${error.message}`);
}
