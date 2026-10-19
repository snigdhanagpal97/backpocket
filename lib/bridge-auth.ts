import { env } from "@/lib/env";
import { verifySignature } from "@/lib/verify-signature";

/** Header the Apps Script bridge signs its requests with: "sha256=<hex HMAC of the body>". */
export const BRIDGE_SIGNATURE_HEADER = "x-backpocket-signature";

/**
 * Reads a signed request from the bridge. Returns the raw body, or a Response
 * to send back when the brief is off or the signature doesn't match.
 */
export async function readSignedBody(request: Request): Promise<{ body: string } | { response: Response }> {
  const secret = env().BRIDGE_SECRET;
  if (!secret) return { response: Response.json({ error: "BRIDGE_SECRET is not set" }, { status: 503 }) };
  const body = await request.text();
  if (!verifySignature(body, request.headers.get(BRIDGE_SIGNATURE_HEADER), secret)) {
    console.warn("[bridge] rejected request with bad or missing signature");
    return { response: Response.json({ error: "invalid signature" }, { status: 401 }) };
  }
  return { body };
}

/** True if Backpocket serves this phone number. */
export function phoneAllowed(phone: string): boolean {
  return env().ALLOWED_PHONES.includes(phone);
}
