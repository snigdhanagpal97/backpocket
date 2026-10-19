import { describe, expect, it } from "vitest";
import { alreadySavedReply, clampReply, fallbackReply, savedReply, searchReply } from "@/lib/replies";

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

describe("searchReply", () => {
  const pick = (n: number, why = "Uses paneer and spinach") => ({
    item: { title: `Recipe ${n}`, url: `https://example.com/recipe-${n}` },
    why,
  });

  it("lists title, why and link for each pick", () => {
    expect(searchReply([pick(1), pick(2)])).toBe(
      "Recipe 1\nUses paneer and spinach\nhttps://example.com/recipe-1\n\nRecipe 2\nUses paneer and spinach\nhttps://example.com/recipe-2",
    );
  });

  it("leaves out the link line for items without one", () => {
    expect(searchReply([{ item: { title: "Pricing note", url: null }, why: "Your reminder" }])).toBe(
      "Pricing note\nYour reminder",
    );
  });

  it("stays under 700 characters and keeps links whole", () => {
    const longUrl = `https://example.com/${"a".repeat(150)}`;
    const picks = [1, 2, 3].map((n) => ({
      item: { title: `A fairly long saved item title number ${n}`, url: `${longUrl}${n}` },
      why: "w".repeat(200),
    }));
    const reply = searchReply(picks);
    expect(reply.length).toBeLessThanOrEqual(700);
    for (const line of reply.split("\n").filter((l) => l.startsWith("https://"))) {
      expect(line.length).toBe(longUrl.length + 1);
    }
  });
});
