import { describe, expect, it } from "vitest";
import { daysUntil, pickReminders, validMatches } from "@/lib/applications";
import type { ApplicationEmail, OpenJob } from "@/lib/types";

const now = new Date("2026-10-20T10:30:00Z");
const today = "2026-10-20";

function job(id: string, overrides: Partial<OpenJob> = {}): OpenJob {
  return {
    id,
    title: `Job ${id}`,
    url: null,
    job_company: null,
    job_role: null,
    job_deadline: null,
    created_at: "2026-10-10T12:00:00Z",
    last_reminded_at: null,
    ...overrides,
  };
}

const email = (id: string): ApplicationEmail => ({ id, from: "x", subject: "Thanks", date: "2026-10-19T12:00:00Z", snippet: "" });

describe("daysUntil", () => {
  it("counts calendar days", () => {
    expect(daysUntil("2026-10-24", today)).toBe(4);
    expect(daysUntil("2026-10-19", today)).toBe(-1);
  });
});

describe("pickReminders", () => {
  it("puts deadlines in the next week first, then the oldest saves", () => {
    const picked = pickReminders(
      [
        job("new", { created_at: "2026-10-18T12:00:00Z" }),
        job("old", { created_at: "2026-10-01T12:00:00Z" }),
        job("soon", { job_deadline: "2026-10-23" }),
        job("sooner", { job_deadline: "2026-10-21" }),
        job("far", { job_deadline: "2026-12-01", created_at: "2026-10-15T12:00:00Z" }),
      ],
      today,
      now,
    );
    expect(picked.map((j) => j.id)).toEqual(["sooner", "soon", "old"]);
  });

  it("skips posts saved in the last day and ones whose deadline passed", () => {
    const picked = pickReminders(
      [job("fresh", { created_at: "2026-10-20T02:00:00Z" }), job("closed", { job_deadline: "2026-10-19" })],
      today,
      now,
    );
    expect(picked).toEqual([]);
  });

  it("waits 3 days before repeating a reminder, unless it closes within 2", () => {
    const yesterday = "2026-10-19T10:40:00Z";
    const picked = pickReminders(
      [
        job("nagged", { last_reminded_at: yesterday }),
        job("urgent", { last_reminded_at: yesterday, job_deadline: "2026-10-22" }),
        job("due", { last_reminded_at: "2026-10-17T10:50:00Z" }),
      ],
      today,
      now,
    );
    expect(picked.map((j) => j.id)).toEqual(["urgent", "due"]);
  });
});

describe("validMatches", () => {
  it("drops made-up ids and uses each job and email once", () => {
    const result = validMatches(
      [
        { item_id: "a", email_id: "m1" },
        { item_id: "a", email_id: "m2" },
        { item_id: "b", email_id: "m1" },
        { item_id: "ghost", email_id: "m2" },
        { item_id: "b", email_id: "m2" },
      ],
      [job("a"), job("b")],
      [email("m1"), email("m2")],
    );
    expect(result.map(({ job, email }) => `${job.id}:${email.id}`)).toEqual(["a:m1", "b:m2"]);
  });
});
