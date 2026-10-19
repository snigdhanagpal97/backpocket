// Calendar helpers for the morning brief. Parsing and filtering are pure;
// only fetchOutlookEvents touches the network.

import ical, { type VEvent } from "node-ical";
import type { CalendarEvent } from "@/lib/types";

const FETCH_TIMEOUT_MS = 8000;

// Domains that say nothing about who someone works for.
const GENERIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "group.calendar.google.com",
  "resource.calendar.google.com",
]);

// Your own school: every classmate and professor is on it, so it isn't a signal.
const OWN_ORG_DOMAINS = [/(^|\.)unc\.edu$/];

/** "jane@mail.adobe.com" -> "adobe". Null for personal email and your own school. */
export function orgFromEmail(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain || GENERIC_DOMAINS.has(domain) || OWN_ORG_DOMAINS.some((pattern) => pattern.test(domain))) return null;
  const parts = domain.split(".");
  // Drop the TLD (and a second-level one like co.uk), keep the registrable name.
  const name = parts.length >= 3 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2];
  return name || null;
}

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Video-call boilerplate that would drown out what the meeting is about.
const BOILERPLATE = /(join (zoom|microsoft teams|with google meet)|meeting id|passcode|dial[- ]in|one tap mobile|-::~:~::~:)/i;

/** The part of an event description worth searching on. */
export function usefulDescription(description: string, max = 400): string {
  const lines = stripHtml(description)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^https?:\/\/\S+$/.test(line));
  const cut = lines.findIndex((line) => BOILERPLATE.test(line));
  return (cut === -1 ? lines : lines.slice(0, cut)).join(" ").slice(0, max);
}

/** What an event is about, as text to search saved items with. */
export function eventSearchText(event: CalendarEvent, ownEmails: string[] = []): string {
  const own = new Set(ownEmails.map((email) => email.toLowerCase()));
  const others = event.attendees.filter((attendee) => !own.has(attendee.email.toLowerCase()));
  const orgs = [...new Set(others.map((attendee) => orgFromEmail(attendee.email)).filter(Boolean))];
  const names = others.map((attendee) => attendee.name).filter(Boolean).slice(0, 5);
  return [
    event.title,
    usefulDescription(event.description),
    event.location && !/^https?:\/\//.test(event.location) ? event.location : "",
    names.length ? `With: ${names.join(", ")}` : "",
    orgs.length ? `Companies: ${orgs.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const SKIP_TITLES = /^(busy|blocked?|hold|focus( time)?|lunch|gym|commute|ooo|out of office|travel|do not book|dnd)$/i;

/**
 * Timed events worth preparing for, earliest first, at most `max`. Drops
 * all-day events, untitled holds and personal blocks, and the same meeting
 * showing up on both calendars.
 */
export function eventsWorthPrepping(events: CalendarEvent[], max = 6): CalendarEvent[] {
  const seen = new Set<string>();
  return events
    .filter((event) => !event.all_day && event.title.trim() && !SKIP_TITLES.test(event.title.trim()))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .filter((event) => {
      const key = `${event.title.trim().toLowerCase()}|${Date.parse(event.start)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

/** Start and end of a local calendar day, as instants. */
export function dayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  const start = zonedMidnight(date, timeZone);
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 36 * 3600 * 1000).toISOString().slice(0, 10);
  return { start, end: new Date(zonedMidnight(next, timeZone).getTime() - 1) };
}

/** Midnight of `date` in `timeZone`, handling daylight saving. */
function zonedMidnight(date: string, timeZone: string): Date {
  const utcGuess = Date.parse(`${date}T00:00:00Z`);
  let instant = utcGuess;
  // Two passes settle the offset even on a daylight-saving change day.
  for (let i = 0; i < 2; i++) instant = utcGuess - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

function offsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "val" in value) return String((value as { val: unknown }).val ?? "");
  return "";
}

function attendeesOf(event: VEvent): CalendarEvent["attendees"] {
  const raw = event.attendee ? (Array.isArray(event.attendee) ? event.attendee : [event.attendee]) : [];
  return raw.map((attendee) => {
    const params = typeof attendee === "object" && attendee && "params" in attendee ? (attendee.params as Record<string, unknown>) : {};
    return {
      name: typeof params.CN === "string" ? params.CN : "",
      email: text(attendee).replace(/^mailto:/i, ""),
    };
  });
}

/** Events in a published Outlook (ICS) calendar that fall within the day, recurring ones included. */
export function outlookEventsForDay(icsText: string, day: { start: Date; end: Date }): CalendarEvent[] {
  const parsed = ical.sync.parseICS(icsText);
  const events: CalendarEvent[] = [];
  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT") continue;
    const event = component as VEvent;
    // Overrides are applied through their base event's recurrence.
    if (event.recurrenceid) continue;
    if (String(event.status ?? "").toUpperCase() === "CANCELLED") continue;
    for (const instance of ical.expandRecurringEvent(event, { from: day.start, to: day.end, expandOngoing: true })) {
      if (String(instance.event.status ?? "").toUpperCase() === "CANCELLED") continue;
      if (instance.end.getTime() <= day.start.getTime() || instance.start.getTime() > day.end.getTime()) continue;
      events.push({
        id: `outlook:${event.uid}:${instance.start.toISOString()}`,
        title: text(instance.summary).trim(),
        start: instance.start.toISOString(),
        end: instance.end.toISOString(),
        all_day: instance.isFullDay,
        description: text(instance.event.description).slice(0, 4000),
        location: text(instance.event.location).slice(0, 500),
        attendees: attendeesOf(instance.event).slice(0, 100),
        calendar: "outlook",
      });
    }
  }
  return events;
}

/** Fetches and reads a published Outlook calendar. Returns [] (and logs) if it can't. */
export async function fetchOutlookEvents(url: string, day: { start: Date; end: Date }): Promise<CalendarEvent[]> {
  try {
    const response = await fetch(url.replace(/^webcals?:\/\//i, "https://"), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn("[calendar] outlook calendar fetch failed", { status: response.status });
      return [];
    }
    return outlookEventsForDay(await response.text(), day);
  } catch (error) {
    console.warn("[calendar] outlook calendar unreadable", { error: error instanceof Error ? error.message : error });
    return [];
  }
}
