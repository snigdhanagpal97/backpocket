import { describe, expect, it } from "vitest";
import { cardEmbeddingText } from "@/lib/embed";
import { cardSchema } from "@/lib/types";

const valid = {
  item_type: "recipe",
  title: "Palak paneer",
  summary: "A spinach and paneer curry.",
  key_points: ["250 g paneer", "Blend the spinach"],
  entities: { people: [], companies: [] },
  topics: ["paneer", "dinner"],
};

describe("cardSchema", () => {
  it("accepts a valid card", () => {
    expect(cardSchema.parse(valid)).toEqual(valid);
  });

  it("normalizes topics to lowercase hyphenated tags", () => {
    const card = cardSchema.parse({ ...valid, topics: ["#Paneer", "Weeknight Dinner"] });
    expect(card.topics).toEqual(["paneer", "weeknight-dinner"]);
  });

  it.each([
    ["a title over 60 characters", { title: "x".repeat(61) }],
    ["more than 8 key points", { key_points: Array(9).fill("step") }],
    ["fewer than 2 topics", { topics: ["paneer"] }],
    ["more than 5 topics", { topics: ["a", "b", "c", "d", "e", "f"] }],
    ["an unknown item type", { item_type: "video" }],
    ["missing entities", { entities: undefined }],
  ])("rejects %s", (_, change) => {
    expect(cardSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

describe("cardEmbeddingText", () => {
  it("joins title, summary, key points and topics", () => {
    expect(cardEmbeddingText(cardSchema.parse(valid))).toBe(
      "Palak paneer\nA spinach and paneer curry.\n250 g paneer\nBlend the spinach\npaneer dinner",
    );
  });
});
