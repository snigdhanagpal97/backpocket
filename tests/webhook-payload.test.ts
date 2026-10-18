import { describe, expect, it } from "vitest";
import { messagesFromWebhook, whatsappWebhookSchema } from "@/lib/types";

const textPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550000000", phone_number_id: "PNID" },
            contacts: [{ profile: { name: "Test" }, wa_id: "15551234567" }],
            messages: [
              {
                from: "15551234567",
                id: "wamid.ABC",
                timestamp: "1760000000",
                type: "text",
                text: { body: "hello" },
              },
            ],
          },
        },
      ],
    },
  ],
};

const statusPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550000000", phone_number_id: "PNID" },
            statuses: [{ id: "wamid.ABC", status: "delivered", timestamp: "1760000001" }],
          },
        },
      ],
    },
  ],
};

describe("whatsapp webhook parsing", () => {
  it("pulls out text messages", () => {
    const parsed = whatsappWebhookSchema.parse(textPayload);
    expect(messagesFromWebhook(parsed)).toEqual([
      expect.objectContaining({ id: "wamid.ABC", type: "text", text: { body: "hello" } }),
    ]);
  });

  it("returns no messages for a status update", () => {
    const parsed = whatsappWebhookSchema.parse(statusPayload);
    expect(messagesFromWebhook(parsed)).toEqual([]);
  });
});
