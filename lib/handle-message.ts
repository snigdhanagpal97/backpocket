import { buildCard } from "@/lib/card";
import {
  claimFallback,
  findPendingFallback,
  findSameContent,
  insertItem,
  messageAlreadySaved,
  releaseFallback,
  updateItem,
  type ItemRow,
} from "@/lib/db";
import { cardEmbeddingText, embed } from "@/lib/embed";
import { extractContent, UnsupportedMessageError } from "@/lib/extract";
import {
  alreadySavedReply,
  fallbackReply,
  SAVE_FAILED,
  savedReply,
  SEARCH_FAILED,
  UNSUPPORTED,
} from "@/lib/replies";
import { routeMessage } from "@/lib/intent";
import { listSaved, markFromList, recentListTitles } from "@/lib/list";
import { answerQuestion } from "@/lib/search";
import type { Card, ExtractedContent, Source, WhatsAppMessage } from "@/lib/types";
import { sendText } from "@/lib/whatsapp";

const FALLBACK_WINDOW_MS = 10 * 60 * 1000;

export async function handleMessage(message: WhatsAppMessage): Promise<void> {
  const phone = message.from;
  let isQuestion = false;
  try {
    // Meta retries webhooks; the same message id must never be saved twice.
    if (await messageAlreadySaved(message.id, `${phone}/${message.id}`)) {
      console.info("[handle-message] skipping already saved message", { messageId: message.id });
      return;
    }

    let extracted = await extractContent(message);

    // Text without a link: Claude decides whether it's a note, a question, a list request or "I applied to 2".
    if (extracted.source === "note" || extracted.source === "query") {
      const lastList = await recentListTitles(phone);
      const intent = await routeMessage(extracted.rawText, lastList.titles);
      if (intent.kind !== "note") {
        isQuestion = true;
        if (intent.kind === "mark_done" || intent.kind === "unmark_done") {
          await sendText(phone, await markFromList(phone, intent, lastList));
          return;
        }
        const replies =
          intent.kind === "list"
            ? await listSaved(phone, intent, extracted.rawText)
            : await answerQuestion(phone, intent.search_text || extracted.rawText, extracted.rawText);
        for (const reply of replies) await sendText(phone, reply.text, { replyTo: reply.replyTo });
        return;
      }
      extracted = { ...extracted, source: "note" };
    }

    if (extracted.source === "screenshot") {
      const pending = await findPendingFallback(phone, new Date(Date.now() - FALLBACK_WINDOW_MS));
      // If another screenshot claimed the link first, save this one on its own.
      if (pending && (await claimFallback(pending.id))) {
        await attachScreenshot(pending, extracted);
        return;
      }
    }

    const duplicate = await findDuplicate(phone, extracted);
    if (duplicate) {
      await sendText(phone, alreadySavedReply(duplicate.title));
      return;
    }

    if (extracted.status === "needs_fallback") {
      const saved = await insertItem({
        user_phone: phone,
        source: extracted.source,
        url: extracted.url,
        raw_text: extracted.rawText,
        status: "needs_fallback",
        wa_message_id: message.id,
      });
      if (saved) await sendText(phone, fallbackReply(extracted.source));
      return;
    }

    const card = await buildCard(extracted);
    const saved = await insertItem({
      ...(await cardFields(card)),
      user_phone: phone,
      source: extracted.source,
      url: extracted.url,
      raw_text: withImageText(extracted.rawText, card),
      image_path: extracted.imagePath ?? null,
      status: "complete",
      wa_message_id: message.id,
    });
    // null means a retried webhook beat us to the insert; it already replied.
    if (saved) await sendText(phone, savedReply(card));
  } catch (error) {
    if (error instanceof UnsupportedMessageError) {
      await sendText(phone, UNSUPPORTED);
      return;
    }
    console.error("[handle-message] failed", {
      messageId: message.id,
      type: message.type,
      isQuestion,
      error: error instanceof Error ? error.message : error,
    });
    await sendText(phone, isQuestion ? SEARCH_FAILED : SAVE_FAILED);
  }
}

async function cardFields(card: Card) {
  return {
    item_type: card.item_type,
    title: card.title,
    summary: card.summary,
    key_points: card.key_points,
    entities: card.entities,
    topics: card.topics,
    embedding: await embed(cardEmbeddingText(card)),
  };
}

/** Keeps the text read from a screenshot with the item, so search can answer from it. */
function withImageText(rawText: string, card: Card): string {
  return [rawText, card.image_text ? `Text in image:\n${card.image_text}` : ""].filter(Boolean).join("\n\n");
}

function findDuplicate(phone: string, extracted: ExtractedContent): Promise<ItemRow | null> {
  if (extracted.url) return findSameContent(phone, { url: extracted.url });
  if (extracted.source === "note") return findSameContent(phone, { note: extracted.rawText });
  return Promise.resolve(null);
}

/** Completes a walled link with the screenshot the user sent for it. */
async function attachScreenshot(pending: ItemRow, screenshot: ExtractedContent): Promise<void> {
  const combined: ExtractedContent = {
    ...screenshot,
    source: pending.source as Source,
    url: pending.url,
    rawText: [pending.raw_text, screenshot.userNote ? `Screenshot caption: ${screenshot.userNote}` : ""]
      .filter(Boolean)
      .join("\n\n"),
    status: "complete",
  };
  let card: Card;
  try {
    card = await buildCard(combined);
    await updateItem(pending.id, {
      ...(await cardFields(card)),
      raw_text: withImageText(combined.rawText, card),
      image_path: screenshot.imagePath ?? null,
      status: "complete",
    });
  } catch (error) {
    await releaseFallback(pending.id);
    throw error;
  }
  await sendText(pending.user_phone, savedReply(card));
}
