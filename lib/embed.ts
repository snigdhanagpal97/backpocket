import OpenAI from "openai";
import { env } from "@/lib/env";
import type { Card } from "@/lib/types";

export const EMBEDDING_MODEL = "text-embedding-3-small";

let client: OpenAI | undefined;

export async function embed(text: string): Promise<number[]> {
  client ??= new OpenAI({ apiKey: env().OPENAI_API_KEY });
  const response = await client.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  return response.data[0].embedding;
}

/** The text a card is embedded as: title, summary, key points and topics. */
export function cardEmbeddingText(card: Card): string {
  return [card.title, card.summary, ...card.key_points, card.topics.join(" ")].join("\n");
}
