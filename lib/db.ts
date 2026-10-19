import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MatchedItem } from "@/lib/types";
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

/** The newest needs_fallback item from this user created after `since`. */
export async function findPendingFallback(phone: string, since: Date): Promise<ItemRow | null> {
  const { data, error } = await db()
    .from("items")
    .select(ITEM_COLUMNS)
    .eq("user_phone", phone)
    .eq("status", "needs_fallback")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fallback lookup failed: ${error.message}`);
  return data as ItemRow | null;
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
