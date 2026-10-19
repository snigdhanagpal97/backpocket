import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  looksLikeLoginWall,
  pageToText,
  parsePage,
  recipeFromJsonLd,
  usefulTextLength,
} from "@/lib/parse-html";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("LinkedIn login wall", () => {
  const page = parsePage(
    fixture("linkedin-login-wall.html"),
    "https://www.linkedin.com/signup/cold-join?session_redirect=https%3A%2F%2Fwww.linkedin.com%2Ffeed%2Fupdate%2Furn%3Ali%3Aactivity%3A1",
  );

  it("is detected", () => {
    expect(page.isLoginWall).toBe(true);
  });

  it("yields no useful text, even though its description is long", () => {
    expect(page.ogDescription!.length).toBeGreaterThan(80);
    expect(pageToText(page, { includeBody: true })).toBe("");
  });

  it("is detected from the title alone when the URL did not change", () => {
    const sameUrl = parsePage(fixture("linkedin-login-wall.html"), "https://www.linkedin.com/posts/x");
    expect(sameUrl.isLoginWall).toBe(true);
  });
});

describe("looksLikeLoginWall", () => {
  it("flags auth paths", () => {
    expect(
      looksLikeLoginWall({ finalUrl: "https://www.linkedin.com/authwall?trk=x", title: null, pageKey: null }),
    ).toBe(true);
    expect(
      looksLikeLoginWall({ finalUrl: "https://www.instagram.com/accounts/login/", title: null, pageKey: null }),
    ).toBe(true);
  });

  it("leaves normal pages alone", () => {
    expect(
      looksLikeLoginWall({
        finalUrl: "https://www.linkedin.com/posts/someone_activity-1",
        title: "Someone on LinkedIn: We shipped it",
        pageKey: "public_post",
      }),
    ).toBe(false);
  });
});

describe("recipe page", () => {
  const page = parsePage(fixture("recipe-page.html"), "https://example.com/palak-paneer");

  it("finds the Recipe inside @graph and skips broken JSON-LD", () => {
    expect(page.recipe).toEqual({
      name: "Palak Paneer (Restaurant Style)",
      description: "Creamy, garlicky palak paneer & soft paneer cubes.",
      ingredients: [
        "250 g paneer, cubed",
        "300 g spinach",
        "1 onion, chopped",
        "3 cloves garlic",
        "2 tbsp cream",
      ],
      instructions: [
        "Spinach:",
        "Blanch the spinach for 2 minutes, then blend.",
        "Fry onion and garlic until golden.",
        "Add the spinach, cream and paneer. Simmer 5 minutes.",
      ],
    });
  });

  it("puts the recipe and page text into the readable text, without nav or footer", () => {
    const text = pageToText(page, { includeBody: true });
    expect(text).toContain("Title: Palak Paneer (Restaurant Style)");
    expect(text).toContain("- 250 g paneer, cubed");
    expect(text).toContain("3. Fry onion and garlic until golden.");
    expect(text).toContain("This is the palak paneer I make on weeknights.");
    expect(text).not.toContain("Example Kitchen</");
    expect(text).not.toContain("©");
    expect(usefulTextLength(text)).toBeGreaterThan(80);
  });
});

describe("recipeFromJsonLd", () => {
  it("reads a top-level array and string instructions", () => {
    const recipe = recipeFromJsonLd([
      [
        { "@type": "Organization", name: "X" },
        {
          "@type": "Recipe",
          name: "Toast",
          recipeIngredient: ["bread"],
          recipeInstructions: "Toast the bread.\nButter it.",
        },
      ],
    ]);
    expect(recipe?.instructions).toEqual(["Toast the bread.", "Butter it."]);
  });

  it("returns null without a Recipe", () => {
    expect(recipeFromJsonLd([{ "@type": "Article", headline: "Hi" }])).toBeNull();
  });
});

describe("usefulTextLength", () => {
  it("ignores labels", () => {
    expect(usefulTextLength("Title: Instagram")).toBe("Instagram".length);
  });
});
