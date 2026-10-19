import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dayBounds,
  eventSearchText,
  eventsWorthPrepping,
  orgFromEmail,
  outlookEventsForDay,
  usefulDescription,
} from "@/lib/calendar";
import type { CalendarEvent } from "@/lib/types";

const ics = readFileSync(new URL("./fixtures/outlook.ics", import.meta.url), "utf8");

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "e1",
    title: "Coffee chat",
    start: "2026-10-20T18:00:00.000Z",
    end: "2026-10-20T18:30:00.000Z",
    all_day: false,
    description: "",
    location: "",
    attendees: [],
    calendar: "google",
    ...overrides,
  };
}

describe("dayBounds", () => {
  it("covers a local day in New York during daylight time", () => {
    const { start, end } = dayBounds("2026-10-20", "America/New_York");
    expect(start.toISOString()).toBe("2026-10-20T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-21T03:59:59.999Z");
  });

  it("handles the day clocks fall back", () => {
    const { start, end } = dayBounds("2026-11-01", "America/New_York");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T04:59:59.999Z");
  });
});

describe("orgFromEmail", () => {
  it.each([
    ["priya@adobe.com", "adobe"],
    ["a@mail.stripe.com", "stripe"],
    ["b@bbc.co.uk", "bbc"],
    ["me@gmail.com", null],
    ["prof@kenan-flagler.unc.edu", null],
    ["no-at-sign", null],
  ])("%s -> %s", (email, org) => {
    expect(orgFromEmail(email)).toBe(org);
  });
});

describe("usefulDescription", () => {
  it("keeps the agenda and drops video-call boilerplate", () => {
    const text = "Talk about growth PM roles<br>https://zoom.us/j/1<br>Join Zoom Meeting<br>Meeting ID: 1";
    expect(usefulDescription(text)).toBe("Talk about growth PM roles");
  });
});

describe("eventSearchText", () => {
  it("adds who the meeting is with and their company", () => {
    const text = eventSearchText(
      event({ attendees: [{ name: "Priya Shah", email: "priya@adobe.com" }, { name: "Me", email: "me@gmail.com" }] }),
      ["me@gmail.com"],
    );
    expect(text).toBe("Coffee chat\nWith: Priya Shah\nCompanies: adobe");
  });
});

describe("eventsWorthPrepping", () => {
  it("drops all-day events, personal blocks and duplicates across calendars, earliest first", () => {
    const events = [
      event({ id: "late", title: "Case team meeting", start: "2026-10-20T20:00:00Z" }),
      event({ id: "allday", title: "Fall break", all_day: true }),
      event({ id: "lunch", title: "Lunch" }),
      event({ id: "g", title: "Coffee chat", start: "2026-10-20T18:00:00Z" }),
      event({ id: "o", title: "coffee chat ", start: "2026-10-20T18:00:00.000Z", calendar: "outlook" }),
    ];
    expect(eventsWorthPrepping(events).map((e) => e.id)).toEqual(["g", "late"]);
  });
});

describe("outlookEventsForDay", () => {
  it("expands recurring classes and skips cancelled and other-day events", () => {
    const events = outlookEventsForDay(ics, dayBounds("2026-10-20", "America/New_York"));
    const titles = events.map((e) => e.title).sort();
    expect(titles).toEqual(["Coffee chat - Adobe", "MBA 741 Operations"]);

    const coffee = events.find((e) => e.title === "Coffee chat - Adobe")!;
    expect(coffee.start).toBe("2026-10-20T18:00:00.000Z");
    expect(coffee.attendees).toContainEqual({ name: "Priya Shah", email: "priya@adobe.com" });

    const ops = events.find((e) => e.title === "MBA 741 Operations")!;
    expect(ops.start).toBe("2026-10-20T13:30:00.000Z");
  });

  it("finds nothing on a day with no events", () => {
    expect(outlookEventsForDay(ics, dayBounds("2026-10-22", "America/New_York"))).toEqual([]);
  });
});
