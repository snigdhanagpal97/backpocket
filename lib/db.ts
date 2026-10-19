import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
