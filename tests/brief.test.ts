import { describe, expect, it, vi } from "vitest";

// brief.ts pulls in the network modules; only its pure helper is tested here.
vi.mock("@/lib/db", () => ({}));
vi.mock("@/lib/whatsapp", () => ({ OUTSIDE_WINDOW_CODE: 131047, WhatsAppError: class extends Error {} }));

import { validPrep } from "@/lib/brief";
import { briefMessages, jobLabel, jobTiming } from "@/lib/replies";
import type { CalendarEvent } from "@/lib/types";

const ev = (id: string, title: string, start: string): CalendarEvent => ({
  id,
  title,
  start,
  end: start,
  all_day: false,
  description: "",
  location: "",
  attendees: [],
  calendar: "google",
});

describe("validPrep", () => {
  it("keeps only real candidates for that event, each item once, and drops empty events", () => {
    const events = [ev("e1", "Coffee chat - Adobe", "2026-10-20T18:00:00Z"), ev("e2", "Ops class", "2026-10-20T13:30:00Z")];
    const items = new Map([
      ["i1", { id: "i1", title: "Adobe PM loop", url: "https://x.com/1" }],
      ["i2", { id: "i2", title: "Littles law", url: null }],
    ]);
    const prep = validPrep(
      [
        { event_id: "e1", items: [{ item_id: "i1", note: "Two rounds" }, { item_id: "i2", note: "not a candidate here" }] },
        { event_id: "e2", items: [{ item_id: "i1", note: "already used" }] },
        { event_id: "ghost", items: [{ item_id: "i2", note: "x" }] },
      ],
      events,
      [["i1"], ["i1", "i2"]],
      items,
    );
    expect(prep).toEqual([
      { start: "2026-10-20T18:00:00Z", title: "Coffee chat - Adobe", items: [{ id: "i1", title: "Adobe PM loop", url: "https://x.com/1", note: "Two rounds" }] },
    ]);
  });
});

describe("jobLabel", () => {
  it("adds the company unless the role already names it", () => {
    expect(jobLabel({ title: null, job_role: "PM Intern", job_company: "Nordstrom" })).toBe("PM Intern, Nordstrom");
    expect(jobLabel({ title: null, job_role: "Stripe PM Intern", job_company: "Stripe" })).toBe("Stripe PM Intern");
    expect(jobLabel({ title: "Saved post", job_role: null, job_company: null })).toBe("Saved post");
  });
});

describe("jobTiming", () => {
  const created_at = "2026-10-12T15:00:00Z";
  it.each([
    ["2026-10-20", "closes today"],
    ["2026-10-21", "closes tomorrow"],
    ["2026-10-23", "closes Fri"],
    ["2026-11-14", "closes Nov 14"],
  ])("deadline %s -> %s", (deadline, text) => {
    expect(jobTiming({ job_deadline: deadline, created_at }, "2026-10-20")).toBe(text);
  });

  it("says how long ago it was saved when there's no deadline", () => {
    expect(jobTiming({ job_deadline: null, created_at }, "2026-10-20")).toBe("saved 8 days ago");
  });
});

describe("briefMessages", () => {
  const base = { today: "2026-10-20", timeZone: "America/New_York", prep: [], reminders: [], applied: [] };

  it("sends nothing on a quiet day", () => {
    expect(briefMessages(base)).toEqual([]);
  });

  it("leads with applications found, then prep, then numbered reminders", () => {
    const [message, ...rest] = briefMessages({
      ...base,
      applied: [{ title: null, job_company: "Nordstrom" }, { title: null, job_company: "Notion" }],
      prep: [
        {
          start: "2026-10-20T18:00:00Z",
          title: "Coffee chat - Adobe",
          items: [{ id: "i1", title: "Adobe PM loop", url: "https://lnkd.in/a", note: "Their loop has a metrics round." }],
        },
        { start: "2026-10-20T13:30:00Z", title: "Ops class", items: [] },
      ],
      reminders: [
        { title: null, url: "https://jobs.x/1", job_company: "Stripe", job_role: "PM Intern", job_deadline: "2026-10-21", created_at: "2026-10-12T00:00:00Z" },
      ],
    });
    expect(rest).toEqual([]);
    expect(message.text).toBe(
      [
        "Saw your application email for Nordstrom and Notion, so I marked them applied.",
        "For today:",
        "2:00 PM Coffee chat - Adobe\n- Their loop has a metrics round.\nhttps://lnkd.in/a",
        "Still to apply:",
        "1. PM Intern, Stripe (closes tomorrow)\nhttps://jobs.x/1",
        'Applied to any? Reply with the numbers, like 1, 2. Not going for one? Say "skip 2".',
      ].join("\n\n"),
    );
  });

  it("splits a long brief across messages without breaking a block", () => {
    const reminders = Array.from({ length: 3 }, (_, i) => ({
      title: null,
      url: `https://example.com/${"x".repeat(250)}/${i}`,
      job_company: `Company ${i}`,
      job_role: "Product Manager Intern",
      job_deadline: null,
      created_at: "2026-10-01T00:00:00Z",
    }));
    const messages = briefMessages({ ...base, reminders });
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) expect(m.text.length).toBeLessThanOrEqual(700);
    expect(messages.map((m) => m.text).join("\n\n")).toContain("3. Product Manager Intern, Company 2");
  });
});
