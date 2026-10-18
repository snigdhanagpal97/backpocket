import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(rawBody: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Checks Meta's X-Hub-Signature-256 header against an HMAC SHA256 of the raw
 * request body. Must run on the exact bytes Meta sent, before JSON parsing.
 */
export function verifySignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
): boolean {
  if (!header || !header.startsWith("sha256=")) return false;

  const expected = Buffer.from(signBody(rawBody, secret), "utf8");
  const received = Buffer.from(header, "utf8");
  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}
