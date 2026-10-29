import { describe, expect, it } from "vitest";
import { expectedContent } from "@/lib/fallback-match";

describe("expectedContent", () => {
  it.each([
    ["https://www.linkedin.com/jobs/view/4471385322/", "a LinkedIn job listing"],
    ["https://www.linkedin.com/posts/someone_topic-activity-1-abc", "a LinkedIn post"],
    ["https://www.linkedin.com/feed/update/urn:li:activity:1/", "a LinkedIn post"],
    ["https://www.linkedin.com/in/someone/", "a LinkedIn profile"],
    ["https://www.instagram.com/reel/Dep9jgqxRXP/", "an Instagram reel (often its caption or a frame of the video)"],
    ["https://www.instagram.com/p/abc/", "an Instagram post"],
    ["https://www.example.com/article", "a page from example.com"],
  ])("%s is %s", (url, expected) => {
    expect(expectedContent(url)).toBe(expected);
  });

  it("falls back for a missing or broken link", () => {
    expect(expectedContent(null)).toBe("a post or page");
    expect(expectedContent("not a url")).toBe("a post or page");
  });
});
