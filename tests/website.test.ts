import { describe, it, expect } from "vitest";
import { findMatchingLinks } from "../src/scrapers/website";

describe("scrapers/website findMatchingLinks", () => {
  it("matches the real about/contact/careers pages by exact path segment", () => {
    const html = `
      <html><body>
        <footer>
          <a href="/about-us">About</a>
          <a href="/contact">Contact</a>
          <a href="/careers">Careers</a>
        </footer>
      </body></html>
    `;
    const links = findMatchingLinks(html, "https://fixtureco.com");
    expect(links.sort()).toEqual(
      [
        "https://fixtureco.com/about-us",
        "https://fixtureco.com/contact",
        "https://fixtureco.com/careers",
      ].sort()
    );
  });

  it("prioritizes exact-path nav links over a flood of incidental blog-slug matches", () => {
    // Regression: a "Latest from our blog" section with >8 posts whose
    // slugs incidentally match ("jobs", "team", ...) used to exhaust the
    // MAX_MATCHED_LINKS budget before the real footer nav was ever reached.
    const blogPosts = Array.from(
      { length: 10 },
      (_, i) => `<a href="/blog/team-culture-post-${i}">Team Culture, Part ${i}</a>`
    ).join("\n");

    const html = `
      <html><body>
        <main>${blogPosts}</main>
        <footer>
          <a href="/about">About</a>
          <a href="/careers">Careers</a>
        </footer>
      </body></html>
    `;

    const links = findMatchingLinks(html, "https://fixtureco.com");
    expect(links).toContain("https://fixtureco.com/about");
    expect(links).toContain("https://fixtureco.com/careers");
  });

  it("stays on the same origin and skips mailto/tel/anchor links", () => {
    const html = `
      <html><body>
        <a href="#top">Top</a>
        <a href="mailto:careers@fixtureco.com">Email careers</a>
        <a href="tel:+911234567890">Call jobs desk</a>
        <a href="https://external-jobs-board.com/careers">External board</a>
        <a href="/careers">Careers</a>
      </body></html>
    `;
    const links = findMatchingLinks(html, "https://fixtureco.com");
    expect(links).toEqual(["https://fixtureco.com/careers"]);
  });

  it("caps at MAX_MATCHED_LINKS (8) even when every candidate is equally scored", () => {
    const links = Array.from(
      { length: 15 },
      (_, i) => `<a href="/blog/hiring-tip-${i}">Hiring Tip ${i}</a>`
    ).join("\n");
    const html = `<html><body>${links}</body></html>`;
    expect(findMatchingLinks(html, "https://fixtureco.com").length).toBe(8);
  });
});
