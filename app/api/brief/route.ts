import { readSignedBody, phoneAllowed } from "@/lib/bridge-auth";
import { runBrief } from "@/lib/brief";
import { briefRequestSchema } from "@/lib/types";

// Outlook fetch, two model calls and a few sends.
export const maxDuration = 60;

/**
 * Called each morning by the Apps Script bridge with today's calendar events
 * and recent application-confirmation emails. Sends the brief and returns what
 * it did, so a manual run in the Apps Script editor shows the result.
 */
export async function POST(request: Request) {
  const signed = await readSignedBody(request);
  if ("response" in signed) return signed.response;

  let json: unknown;
  try {
    json = JSON.parse(signed.body);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = briefRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid brief request", issues: parsed.error.issues.slice(0, 10) }, { status: 400 });
  }
  if (!phoneAllowed(parsed.data.phone)) {
    return Response.json({ error: "phone is not in ALLOWED_PHONES" }, { status: 403 });
  }

  try {
    return Response.json(await runBrief(parsed.data));
  } catch (error) {
    console.error("[brief] failed", { error: error instanceof Error ? error.message : error });
    return Response.json({ error: "brief failed, see the server logs" }, { status: 500 });
  }
}
