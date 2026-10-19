import { extractContent, UnsupportedMessageError } from "@/lib/extract";
import type { WhatsAppMessage } from "@/lib/types";
import { sendText } from "@/lib/whatsapp";

export async function handleMessage(message: WhatsAppMessage): Promise<void> {
  try {
    const extracted = await extractContent(message);
    // Temporary until Phase 4 builds cards: show what extraction found.
    await sendText(message.from, `Got it · ${extracted.source} · ${extracted.status}`);
  } catch (error) {
    if (error instanceof UnsupportedMessageError) {
      await sendText(message.from, "I can save links, screenshots and text for now.");
      return;
    }
    console.error("[handle-message] failed", {
      messageId: message.id,
      type: message.type,
      error: error instanceof Error ? error.message : error,
    });
    await sendText(message.from, "Couldn't save that one, try again?");
  }
}
