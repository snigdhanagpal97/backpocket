import { describe, expect, it } from "vitest";
import { alreadySavedReply, clampReply, fallbackReply, savedReply, searchMessages } from "@/lib/replies";

describe("savedReply", () => {
  it("shows the title, then type and hashtags on the next line", () => {
    expect(
      savedReply({ title: "Palak paneer", item_type: "recipe", topics: ["paneer", "weeknight-dinner"] }),
    ).toBe("Saved: Palak paneer\nrecipe · #paneer #weeknight-dinner");
  });

  it("writes how_to as how-to", () => {
    expect(savedReply({ title: "T", item_type: "how_to", topics: ["a", "b"] })).toContain("how-to ·");
  });
});

describe("fallbackReply", () => {
  it("names the platform that hid the content", () => {
    expect(fallbackReply("linkedin")).toBe(
      "Saved the link, but LinkedIn hid the content. Send a screenshot in the next 10 minutes and I'll attach it.",
    );
    expect(fallbackReply("instagram")).toContain("Instagram hid the content");
  });

  it("is honest when an ordinary page failed to load", () => {
    expect(fallbackReply("web")).toContain("I couldn't read that page");
  });
});

describe("alreadySavedReply", () => {
  it("uses the title when there is one", () => {
    expect(alreadySavedReply("Palak paneer")).toBe("Already saved: Palak paneer");
    expect(alreadySavedReply(null)).toBe("Already saved that one.");
  });
});

describe("clampReply", () => {
  it("leaves short replies alone", () => {
    expect(clampReply("hi")).toBe("hi");
  });

  it("cuts long replies at a word boundary under the limit", () => {
    const long = "word ".repeat(300);
    const clamped = clampReply(long);
    expect(clamped.length).toBeLessThanOrEqual(700);
    expect(clamped.endsWith("word…")).toBe(true);
  });
});

describe("searchMessages", () => {
  const item = (n: number, url: string | null = `https://example.com/${n}`) => ({
    title: `Item ${n}`,
    url,
    wa_message_id: `wamid.${n}`,
  });

  it("sends the answer as a reply to the top item, with its link", () => {
    expect(searchMessages("Aditi said the framework is good.", [item(1)])).toEqual([
      { text: "Aditi said the framework is good.\n\nhttps://example.com/1", replyTo: "wamid.1" },
    ]);
  });

  it("leaves out the link when the item has none", () => {
    expect(searchMessages("Your slide lists four types.", [item(1, null)])).toEqual([
      { text: "Your slide lists four types.", replyTo: "wamid.1" },
    ]);
  });

  it("adds a short quoted reply for each other item", () => {
    const messages = searchMessages("Answer", [item(1), item(2), item(3, null)]);
    expect(messages.slice(1)).toEqual([
      { text: "Also from your saves: Item 2\nhttps://example.com/2", replyTo: "wamid.2" },
      { text: "Also from your saves: Item 3", replyTo: "wamid.3" },
    ]);
  });

  it("keeps every message under 700 characters without cutting the link", () => {
    const url = `https://example.com/${"a".repeat(200)}`;
    const [first] = searchMessages("word ".repeat(300), [item(1, url)]);
    expect(first.text.length).toBeLessThanOrEqual(700);
    expect(first.text.endsWith(url)).toBe(true);
  });
});
