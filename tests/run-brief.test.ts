import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefRequest, OpenJob } from "@/lib/types";

// The whole morning run with the database, models and WhatsApp faked.

const state = vi.hoisted(() => ({
  lastBriefDate: null as string | null,
  jobs: [] as OpenJob[],
  sent: [] as string[],
  templates: [] as string[],
  pending: null as string[] | null,
  done: [] as { ids: string[]; label: string | null; source?: string }[],
  lastList: [] as string[],
  reminded: [] as string[],
  resurfaced: [] as { ids: string[]; trigger: string }[],
  briefSent: [] as string[],
  outsideWindow: false,
  matchAnswer: { matches: [] as { item_id: string; email_id: string }[] },
  pickAnswer: { events: [] as unknown[] },
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ WHATSAPP_BRIEF_TEMPLATE: "brief_ready", WHATSAPP_BRIEF_TEMPLATE_LANG: "en" }),
}));
vi.mock("@/lib/embed", () => ({ embed: async () => [0.1, 0.2] }));
vi.mock("@/lib/claude", () => ({
  ToolCallError: class extends Error {},
  callTool: async ({ tool }: { tool: { name: string } }) =>
    tool.name === "match_applications" ? state.matchAnswer : state.pickAnswer,
}));
vi.mock("@/lib/whatsapp", () => {
  class WhatsAppError extends Error {
    constructor(message: string, public status: number, public code: number | null) {
      super(message);
    }
  }
  return {
    OUTSIDE_WINDOW_CODE: 131047,
    WhatsAppError,
    sendText: async (_to: string, text: string) => {
      if (state.outsideWindow) throw new WhatsAppError("outside window", 400, 131047);
      state.sent.push(text);
    },
    sendTemplate: async (_to: string, name: string) => {
      state.templates.push(name);
    },
  };
});
vi.mock("@/lib/db", () => ({
  getBriefState: async () => ({ lastBriefDate: state.lastBriefDate }),
  openJobs: async () => state.jobs,
  matchItems: async () => [{ id: "i1" }],
  getSearchItems: async (ids: string[]) =>
    ids.includes("i1")
      ? [{ id: "i1", title: "Adobe PM loop", summary: "s", key_points: [], raw_text: "", url: "https://lnkd.in/a", item_type: "post", wa_message_id: "w", done_at: null, done_label: null }]
      : [],
  setDone: async (_p: string, ids: string[], label: string | null, options: { source?: string } = {}) => {
    state.done.push({ ids, label, source: options.source });
    return [];
  },
  saveLastList: async (_p: string, ids: string[]) => {
    state.lastList = ids;
  },
  markReminded: async (ids: string[]) => {
    state.reminded.push(...ids);
  },
  recordResurfacing: async (ids: string[], trigger: string) => {
    if (ids.length) state.resurfaced.push({ ids, trigger });
  },
  setBriefSent: async (_p: string, date: string) => {
    state.briefSent.push(date);
  },
  savePendingBrief: async (_p: string, texts: string[]) => {
    state.pending = texts;
  },
  takePendingBrief: async () => {
    const texts = state.pending;
    state.pending = null;
    return texts;
  },
}));

import { deliverPendingBrief, runBrief } from "@/lib/brief";

const now = new Date("2026-10-20T10:30:00Z");

const request = (overrides: Partial<BriefRequest> = {}): BriefRequest => ({
  phone: "15551234567",
  date: "2026-10-20",
  timezone: "America/New_York",
  events: [
    {
      id: "e1",
      title: "Coffee chat - Adobe",
      start: "2026-10-20T18:00:00Z",
      end: "2026-10-20T18:30:00Z",
      all_day: false,
      description: "",
      location: "",
      attendees: [{ name: "Priya", email: "priya@adobe.com" }],
      calendar: "google",
    },
  ],
  emails: [{ id: "m1", from: "Nordstrom", subject: "Thanks for applying", date: "2026-10-19T16:00:00Z", snippet: "" }],
  force: false,
  dry_run: false,
  ...overrides,
});

const job = (id: string, company: string): OpenJob => ({
  id,
  title: `${company} PM Intern`,
  url: `https://jobs/${id}`,
  job_company: company,
  job_role: "PM Intern",
  job_deadline: null,
  created_at: "2026-10-10T12:00:00Z",
  last_reminded_at: null,
});

beforeEach(() => {
  Object.assign(state, {
    lastBriefDate: null,
    jobs: [job("j1", "Nordstrom"), job("j2", "Stripe")],
    sent: [],
    templates: [],
    pending: null,
    done: [],
    lastList: [],
    reminded: [],
    resurfaced: [],
    briefSent: [],
    outsideWindow: false,
    matchAnswer: { matches: [{ item_id: "j1", email_id: "m1" }] },
    pickAnswer: { events: [{ event_id: "e1", items: [{ item_id: "i1", note: "Their loop has a metrics round." }] }] },
  });
});

describe("runBrief", () => {
  it("marks the emailed application, preps the meeting and reminds about the rest", async () => {
    const result = await runBrief(request(), now);

    expect(result.status).toBe("sent");
    expect(state.done).toEqual([{ ids: ["j1"], label: "applied", source: "email" }]);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toContain("Saw your application email for Nordstrom");
    expect(state.sent[0]).toContain("2:00 PM Coffee chat - Adobe\n- Their loop has a metrics round.");
    expect(state.sent[0]).toContain("1. PM Intern, Stripe (saved 10 days ago)");
    expect(state.sent[0]).not.toContain("PM Intern, Nordstrom");
    // "1" in a reply now means Stripe.
    expect(state.lastList).toEqual(["j2"]);
    expect(state.reminded).toEqual(["j2"]);
    expect(state.resurfaced).toEqual([
      { ids: ["j2"], trigger: "reminder" },
      { ids: ["i1"], trigger: "brief" },
    ]);
    expect(state.briefSent).toEqual(["2026-10-20"]);
  });

  it("doesn't send twice on the same day", async () => {
    state.lastBriefDate = "2026-10-20";
    expect((await runBrief(request(), now)).status).toBe("skipped");
    expect(state.sent).toEqual([]);
  });

  it("sends nothing on a quiet day", async () => {
    state.jobs = [];
    state.pickAnswer = { events: [{ event_id: "e1", items: [] }] };
    const result = await runBrief(request({ emails: [] }), now);
    expect(result.status).toBe("quiet");
    expect(state.sent).toEqual([]);
    expect(state.briefSent).toEqual(["2026-10-20"]);
  });

  it("changes nothing on a dry run", async () => {
    const result = await runBrief(request({ dry_run: true }), now);
    expect(result.status).toBe("dry_run");
    expect(result.messages[0]).toContain("Still to apply:");
    expect(state.sent).toEqual([]);
    expect(state.done).toEqual([]);
    expect(state.briefSent).toEqual([]);
  });

  it("holds the brief outside the 24-hour window and sends it when the user writes", async () => {
    state.outsideWindow = true;
    const result = await runBrief(request(), now);
    expect(result.status).toBe("held");
    expect(state.templates).toEqual(["brief_ready"]);
    expect(state.pending?.[0]).toContain("Still to apply:");

    state.outsideWindow = false;
    expect(await deliverPendingBrief("15551234567")).toBe(true);
    expect(state.sent[0]).toContain("Still to apply:");
    expect(await deliverPendingBrief("15551234567")).toBe(false);
  });

  it("still sends reminders if prep picking breaks", async () => {
    state.pickAnswer = { events: "not a list" as unknown as unknown[] };
    const result = await runBrief(request(), now);
    expect(result.status).toBe("sent");
    expect(result.prep_events).toBe(0);
    expect(state.sent[0]).toContain("1. PM Intern, Stripe");
  });
});
