import { describe, expect, it } from "vitest";
import { classifyUrl, cleanUrl, findUrl, isQuestion, linkedInEmbedUrl, splitLinkAndNote } from "@/lib/classify";

describe("findUrl", () => {
  it("finds an https link inside text", () => {
    expect(findUrl("look at this https://example.com/a?b=1 later")).toBe("https://example.com/a?b=1");
  });

  it("drops trailing punctuation", () => {
    expect(findUrl("saw this (https://example.com/post).")).toBe("https://example.com/post");
  });

  it("adds a scheme to www links", () => {
    expect(findUrl("www.example.com/recipe")).toBe("https://www.example.com/recipe");
  });

  it("returns null when there is no link", () => {
    expect(findUrl("buy milk")).toBeNull();
  });
});

describe("splitLinkAndNote", () => {
  it("keeps what the user typed next to the link", () => {
    expect(splitLinkAndNote("for the offsite https://example.com/x try this")).toEqual({
      url: "https://example.com/x",
      note: "for the offsite try this",
    });
  });

  it("returns a null note for a bare link", () => {
    expect(splitLinkAndNote("  https://example.com/x  ")).toEqual({
      url: "https://example.com/x",
      note: null,
    });
  });
});

describe("classifyUrl", () => {
  it.each([
    ["https://www.linkedin.com/posts/someone_activity-123", "linkedin"],
    ["https://lnkd.in/abc", "linkedin"],
    ["https://www.instagram.com/reel/C8xYz/", "instagram"],
    ["https://instagr.am/p/abc", "instagram"],
    ["https://www.notlinkedin.com/", "web"],
    ["https://www.bbcgoodfood.com/recipes/x", "web"],
  ])("%s is %s", (url, expected) => {
    expect(classifyUrl(url)).toBe(expected);
  });
});

describe("isQuestion", () => {
  it.each([
    "what can I make with paneer?",
    "Find the post about pricing",
    "show me recipes",
    "do I have anything on hiring",
    "any good books",
    "is this saved?",
  ])("treats %j as a question", (text) => {
    expect(isQuestion(text)).toBe(true);
  });

  it.each(["remember to call mum", "anything goes", "Whatever works for dinner", "Showcase ideas"])(
    "treats %j as a note",
    (text) => {
      expect(isQuestion(text)).toBe(false);
    },
  );
});

describe("cleanUrl", () => {
  it("drops share tracking, including who shared it", () => {
    expect(
      cleanUrl(
        "https://www.linkedin.com/posts/someone_topic-activity-7515954543143059456-FKDJ?utm_medium=ios_app&rcm=ACoAAabc&utm_source=social_share&utm_campaign=copy_link",
      ),
    ).toBe("https://www.linkedin.com/posts/someone_topic-activity-7515954543143059456-FKDJ");
    expect(cleanUrl("https://www.instagram.com/reel/Dep9jgqxRXP/?mdxt=MTU3Ng==&igsh=abc")).toBe(
      "https://www.instagram.com/reel/Dep9jgqxRXP/",
    );
  });

  it("drops LinkedIn's highlighted-update parameters", () => {
    expect(
      cleanUrl(
        "https://www.linkedin.com/posts/x-share-7516180321638313985-gb0-/?highlightedUpdateUrn=urn%3Ali%3Aactivity%3A1&highlightedUpdateType=SOCIAL_SHARE&origin=SOCIAL_SHARE",
      ),
    ).toBe("https://www.linkedin.com/posts/x-share-7516180321638313985-gb0-/?origin=SOCIAL_SHARE");
  });

  it("keeps parameters a page needs", () => {
    expect(cleanUrl("https://www.youtube.com/watch?v=abc123&si=track")).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("is applied when finding a link in a message", () => {
    expect(findUrl("look https://example.com/a?utm_source=x&id=7")).toBe("https://example.com/a?id=7");
  });
});

describe("linkedInEmbedUrl", () => {
  it.each([
    [
      "https://www.linkedin.com/posts/someone_topic-activity-7515954543143059456-FKDJ",
      "https://www.linkedin.com/embed/feed/update/urn:li:activity:7515954543143059456",
    ],
    [
      "https://www.linkedin.com/feed/update/urn:li:activity:7515954543143059456/",
      "https://www.linkedin.com/embed/feed/update/urn:li:activity:7515954543143059456",
    ],
    [
      "https://www.linkedin.com/feed/update/urn:li:ugcPost:7515954543143059456",
      "https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:7515954543143059456",
    ],
  ])("builds the embed URL for %s", (url, expected) => {
    expect(linkedInEmbedUrl(url)).toBe(expected);
  });

  it("returns null for links without a post id", () => {
    expect(linkedInEmbedUrl("https://www.linkedin.com/in/someone/")).toBeNull();
  });
});

import { isBareReply } from "@/lib/classify";

describe("isBareReply", () => {
  it.each([
    ["hi", true],
    ["show me", true],
    ["https://x.com/a", false],
    ["Ask Priya about the pricing deck on Friday", false],
  ])("%s -> %s", (text, expected) => {
    expect(isBareReply(text)).toBe(expected);
  });
});
