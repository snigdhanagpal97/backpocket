import { describe, expect, it } from "vitest";
import { allDoneReply, listMessages, markDoneReply, NO_LIST_YET } from "@/lib/replies";

const entry = (n: number, extra: Partial<{ url: string | null; done_label: string | null }> = {}) => ({
  title: `Internship ${n}`,
  url: `https://example.com/${n}`,
  done_label: null,
  ...extra,
});

describe("listMessages", () => {
  it("numbers each item with its link and ends with the follow-up ask", () => {
    const [message] = listMessages("Summer 2027 internships you saved:", [entry(1), entry(2, { url: null })], null);
    expect(message.text).toBe(
      "Summer 2027 internships you saved:\n\n1. Internship 1\nhttps://example.com/1\n\n2. Internship 2\n\nApplied to or done with any? Reply with the numbers, like 1, 3.",
    );
    expect(message.replyTo).toBeNull();
  });

  it("says how many done items it left out", () => {
    const [message] = listMessages("H", [entry(1)], { count: 2, label: "applied" });
    expect(message.text).toContain("Leaving out 2 you already marked applied.");
  });

  it("shows the label on done items when they're included", () => {
    const [message] = listMessages("H", [entry(1, { done_label: "applied" })], null);
    expect(message.text).toContain("1. Internship 1 (applied)");
  });

  it("splits long lists across messages without restarting the numbers", () => {
    const long = Array.from({ length: 12 }, (_, i) => entry(i + 1, { url: `https://example.com/${"x".repeat(80)}/${i + 1}` }));
    const messages = listMessages("H", long, null);
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) expect(m.text.length).toBeLessThanOrEqual(700);
    const all = messages.map((m) => m.text).join("\n\n");
    expect(all).toContain("12. Internship 12");
    expect(messages.at(-1)!.text.endsWith("like 1, 3.")).toBe(true);
  });
});

describe("markDoneReply", () => {
  it("confirms what was marked", () => {
    expect(markDoneReply("applied", ["Nordstrom", "Epic Games"], { badNumbers: [], unmatched: [] })).toBe(
      "Marked applied:\n- Nordstrom\n- Epic Games\nI'll leave them out of future lists.",
    );
  });

  it("says it for one item", () => {
    expect(markDoneReply("applied", ["Nordstrom"], { badNumbers: [], unmatched: [] })).toContain(
      "I'll leave it out of future lists.",
    );
  });

  it("confirms an undo", () => {
    expect(markDoneReply(null, ["Nordstrom"], { badNumbers: [], unmatched: [] })).toBe(
      "Moved back to your lists:\n- Nordstrom",
    );
  });

  it("explains numbers and names it couldn't match", () => {
    const reply = markDoneReply("applied", ["Nordstrom"], { badNumbers: [9], unmatched: ["Google"] });
    expect(reply).toContain("The last list didn't have 9.");
    expect(reply).toContain("I couldn't find Google in the last list.");
  });

  it("asks for a list when nothing matched", () => {
    expect(markDoneReply("applied", [], { badNumbers: [], unmatched: [] })).toBe(NO_LIST_YET);
  });
});

describe("allDoneReply", () => {
  it("says everything matching is already done", () => {
    expect(allDoneReply(3, "applied")).toContain("All 3 matches are already marked applied.");
  });
});
