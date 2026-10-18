import { z } from "zod";

// WhatsApp Cloud API webhook payload. Only the fields Backpocket reads are
// listed; zod drops the rest.

export const whatsappMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z
    .object({
      id: z.string(),
      mime_type: z.string().optional(),
      caption: z.string().optional(),
    })
    .optional(),
});

export type WhatsAppMessage = z.infer<typeof whatsappMessageSchema>;

export const whatsappWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            messaging_product: z.string().optional(),
            metadata: z
              .object({
                display_phone_number: z.string(),
                phone_number_id: z.string(),
              })
              .optional(),
            messages: z.array(whatsappMessageSchema).optional(),
          }),
        }),
      ),
    }),
  ),
});

export type WhatsAppWebhook = z.infer<typeof whatsappWebhookSchema>;

/** Every message in a webhook, across entries and changes. Status updates have none. */
export function messagesFromWebhook(payload: WhatsAppWebhook): WhatsAppMessage[] {
  return payload.entry.flatMap((entry) =>
    entry.changes.flatMap((change) => change.value.messages ?? []),
  );
}
