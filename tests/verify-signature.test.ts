import { describe, expect, it } from "vitest";
import { signBody, verifySignature } from "@/lib/verify-signature";

const secret = "app-secret";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

describe("verifySignature", () => {
  it("accepts a valid signature", () => {
    expect(verifySignature(body, signBody(body, secret), secret)).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifySignature(body, signBody(body, "wrong"), secret)).toBe(false);
  });

  it("rejects a signature for a different body", () => {
    expect(verifySignature(body + " ", signBody(body, secret), secret)).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(verifySignature(body, "sha256=abc", secret)).toBe(false);
    expect(verifySignature(body, "md5=whatever", secret)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, undefined, secret)).toBe(false);
    expect(verifySignature(body, "", secret)).toBe(false);
  });
});
