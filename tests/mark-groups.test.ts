import { describe, expect, it } from "vitest";
import { markGroups } from "@/lib/list";
import type { Intent } from "@/lib/types";

const intent = (partial: Partial<Intent>): Intent => ({
  kind: "mark_done",
  search_text: "",
  numbers: [],
  unmatched_names: [],
  done_label: "",
  also_done: [],
  include_done: false,
  ...partial,
});

describe("markGroups", () => {
  it("keeps one action as one group", () => {
    expect(markGroups(intent({ numbers: [1, 3], done_label: "applied" }))).toEqual([
      { label: "applied", numbers: [1, 3] },
    ]);
  });

  it("splits different actions in one message", () => {
    expect(
      markGroups(intent({ numbers: [1], done_label: "skipped", also_done: [{ number: 3, label: "applied" }] })),
    ).toEqual([
      { label: "skipped", numbers: [1] },
      { label: "applied", numbers: [3] },
    ]);
  });

  it("counts an item once when it's listed under both actions", () => {
    expect(
      markGroups(intent({ numbers: [1, 3], done_label: "skipped", also_done: [{ number: 3, label: "applied" }] })),
    ).toEqual([
      { label: "skipped", numbers: [1] },
      { label: "applied", numbers: [3] },
    ]);
  });

  it("merges an extra action that repeats the main label", () => {
    expect(
      markGroups(intent({ numbers: [1], done_label: "applied", also_done: [{ number: 2, label: "applied" }] })),
    ).toEqual([{ label: "applied", numbers: [1, 2] }]);
  });

  it("uses a null label when taking something back", () => {
    expect(markGroups(intent({ kind: "unmark_done", numbers: [2] }))).toEqual([{ label: null, numbers: [2] }]);
  });
});
