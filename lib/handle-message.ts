import type { WhatsAppMessage } from "@/lib/types";
import { sendText } from "@/lib/whatsapp";

export async function handleMessage(message: WhatsAppMessage): Promise<void> {
  await sendText(message.from, "Got it");
}
