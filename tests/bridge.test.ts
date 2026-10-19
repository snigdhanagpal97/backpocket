import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { briefRequestSchema } from "@/lib/types";
import { verifySignature } from "@/lib/verify-signature";

// Runs the Apps Script bridge against fake Google services and checks that
// what it sends passes the server's signature check and request schema.

const code = readFileSync(new URL("../bridge/Code.gs", import.meta.url), "utf8");
const SECRET = "test-secret-1234567890";

function runBridge(fn: string) {
  const sent: { url: string; options: { payload: string; headers: Record<string, string> } }[] = [];
  const queries: string[] = [];
  const context = {
    Session: { getScriptTimeZone: () => "America/New_York" },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name: string) =>
          ({ BACKPOCKET_URL: "https://bp.example.com/", BRIDGE_SECRET: SECRET, PHONE: "+1 (555) 123-4567" })[name] ?? null,
      }),
    },
    Utilities: {
      Charset: { UTF_8: "UTF_8" },
      formatDate: (_date: Date, _tz: string, pattern: string) =>
        pattern === "yyyy-MM-dd"
          ? "2026-10-20"
          : pattern.includes("23:59:59")
            ? "2026-10-20T23:59:59-04:00"
            : "2026-10-20T00:00:00-04:00",
      // Apps Script returns Java bytes: signed, -128 to 127.
      computeHmacSha256Signature: (value: string, key: string) =>
        [...createHmac("sha256", key).update(value, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    Calendar: {
      CalendarList: {
        list: () => ({
          items: [
            { id: "me@gmail.com", primary: true },
            { id: "en.usa#holiday@group.v.calendar.google.com", selected: true },
            { id: "hidden@x", selected: false },
          ],
        }),
      },
      Events: {
        list: (calendarId: string) => ({
          items:
            calendarId === "me@gmail.com"
              ? [
                  {
                    id: "ev1",
                    summary: "Coffee chat with Priya — Adobe",
                    start: { dateTime: "2026-10-20T14:00:00-04:00" },
                    end: { dateTime: "2026-10-20T14:30:00-04:00" },
                    description: "Growth PM roles",
                    attendees: [
                      { email: "me@gmail.com", self: true, responseStatus: "accepted" },
                      { email: "priya@adobe.com", displayName: "Priya Shah" },
                      { email: "room@resource.calendar.google.com", resource: true },
                    ],
                  },
                  {
                    id: "ev2",
                    summary: "Declined sync",
                    start: { dateTime: "2026-10-20T15:00:00-04:00" },
                    end: { dateTime: "2026-10-20T16:00:00-04:00" },
                    attendees: [{ email: "me@gmail.com", self: true, responseStatus: "declined" }],
                  },
                  { id: "ev3", summary: "Office", eventType: "workingLocation", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } },
                  { id: "ev4", summary: "Fall break", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } },
                ]
              : [{ id: "h1", summary: "Holiday", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } }],
        }),
      },
    },
    Gmail: {
      Users: {
        Messages: {
          list: (_user: string, options: { q: string }) => {
            queries.push(options.q);
            return { messages: [{ id: "m1" }] };
          },
          get: () => ({
            id: "m1",
            internalDate: String(Date.parse("2026-10-19T16:00:00Z")),
            snippet: "We&#39;ve received your application for Product Intern &amp; will review it",
            payload: {
              headers: [
                { name: "From", value: "Nordstrom <no-reply@us.greenhouse-mail.io>" },
                { name: "Subject", value: "Thank you for applying" },
              ],
            },
          }),
        },
      },
    },
    UrlFetchApp: {
      fetch: (url: string, options: { payload: string; headers: Record<string, string> }) => {
        sent.push({ url, options });
        return { getResponseCode: () => 200, getContentText: () => '{"status":"dry_run","messages":[]}' };
      },
    },
    Logger: { log: () => {} },
    ScriptApp: {},
  };
  vm.createContext(context);
  vm.runInContext(`${code}\n;${fn}();`, context);
  return { sent, queries };
}

describe("Apps Script bridge", () => {
  it("sends a signed request the server accepts", () => {
    const { sent, queries } = runBridge("previewBrief");
    expect(sent).toHaveLength(1);
    const { url, options } = sent[0];
    expect(url).toBe("https://bp.example.com/api/brief");
    expect(/^[\x00-\x7f]*$/.test(options.payload)).toBe(true);
    expect(verifySignature(options.payload, options.headers["x-backpocket-signature"], SECRET)).toBe(true);

    const request = briefRequestSchema.parse(JSON.parse(options.payload));
    expect(request).toMatchObject({ phone: "15551234567", date: "2026-10-20", dry_run: true, force: true });
    expect(queries[0]).toContain("newer_than:3d");
  });

  it("sends today's events without declined, working-location or holiday-calendar entries, and without you or rooms", () => {
    const { sent } = runBridge("sendBrief");
    const request = briefRequestSchema.parse(JSON.parse(sent[0].options.payload));
    expect(request.dry_run).toBe(false);
    expect(request.events.map((e) => e.title)).toEqual(["Coffee chat with Priya — Adobe", "Fall break"]);
    expect(request.events[0].attendees).toEqual([{ name: "Priya Shah", email: "priya@adobe.com" }]);
    expect(request.events[1].all_day).toBe(true);
  });

  it("sends only email metadata and the decoded snippet", () => {
    const { sent } = runBridge("sendBrief");
    const request = briefRequestSchema.parse(JSON.parse(sent[0].options.payload));
    expect(request.emails).toEqual([
      {
        id: "m1",
        from: "Nordstrom <no-reply@us.greenhouse-mail.io>",
        subject: "Thank you for applying",
        date: "2026-10-19T16:00:00.000Z",
        snippet: "We've received your application for Product Intern & will review it",
      },
    ]);
  });
});
