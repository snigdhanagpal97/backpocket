import { z } from "zod";
import { backfillJobs } from "@/lib/backfill-jobs";
import { phoneAllowed, readSignedBody } from "@/lib/bridge-auth";

export const maxDuration = 60;

const requestSchema = z.object({
  phone: z.string().transform((value) => value.replace(/\D/g, "")),
  after_id: z.string().nullable().default(null),
});

/** One batch of the job backfill. scripts/backfill-jobs.ts calls this until `next` is null. */
export async function POST(request: Request) {
  const signed = await readSignedBody(request);
  if ("response" in signed) return signed.response;

  const parsed = requestSchema.safeParse(JSON.parse(signed.body || "{}"));
  if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });
  if (!phoneAllowed(parsed.data.phone)) return Response.json({ error: "phone is not in ALLOWED_PHONES" }, { status: 403 });

  try {
    return Response.json(await backfillJobs(parsed.data.phone, parsed.data.after_id));
  } catch (error) {
    console.error("[backfill-jobs] failed", { error: error instanceof Error ? error.message : error });
    return Response.json({ error: "backfill failed, see the server logs" }, { status: 500 });
  }
}
