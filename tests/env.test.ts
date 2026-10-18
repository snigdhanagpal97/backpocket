import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const valid = {
  WHATSAPP_TOKEN: "token",
  WHATSAPP_PHONE_NUMBER_ID: "123",
  WHATSAPP_VERIFY_TOKEN: "verify",
  WHATSAPP_APP_SECRET: "secret",
  ALLOWED_PHONES: "+1 555 123 4567, 919876543210",
  ANTHROPIC_API_KEY: "sk-ant",
  OPENAI_API_KEY: "sk-openai",
  SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

describe("parseEnv", () => {
  it("parses ALLOWED_PHONES into digit-only numbers", () => {
    expect(parseEnv(valid).ALLOWED_PHONES).toEqual([
      "15551234567",
      "919876543210",
    ]);
  });

  it("names the missing variable", () => {
    expect(() => parseEnv({ ...valid, OPENAI_API_KEY: undefined })).toThrow(/OPENAI_API_KEY \(missing\)/);
  });
});
