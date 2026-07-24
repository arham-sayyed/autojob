import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { extractEmails, pickBestEmail } from "../src/extractors/email";
import { extractPhones, classifyDigits, pickPrimaryPhones } from "../src/extractors/phone";
import { detectATS, findCareersLink, extractJobTitles } from "../src/extractors/careers";
import { detectTechStack, techStackToString } from "../src/extractors/techStack";

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

describe("extractors/email", () => {
  it("extracts a mailto: link and prefers careers@ over generic info@", () => {
    const html = fixture("contact-page-mailto.html");
    const candidates = extractEmails(html);

    expect(candidates).toContainEqual({ email: "info@fixtureco.com", source: "mailto" });
    expect(candidates).toContainEqual({ email: "careers@fixtureco.com", source: "mailto" });

    const best = pickBestEmail(candidates);
    expect(best).toEqual({ email: "careers@fixtureco.com", source: "mailto" });
  });

  it("extracts a footer-only email and tags it as footer", () => {
    const html = fixture("footer-email.html");
    const candidates = extractEmails(html);

    expect(candidates).toContainEqual({ email: "hr@footersite.io", source: "footer" });

    const best = pickBestEmail(candidates);
    expect(best).toEqual({ email: "hr@footersite.io", source: "footer" });
  });

  it("deobfuscates a '[at]'/'[dot]' style email", () => {
    const html = fixture("obfuscated-email.html");
    const candidates = extractEmails(html);

    expect(candidates).toContainEqual({ email: "jobs@obfusco.com", source: "obfuscated" });

    const best = pickBestEmail(candidates);
    expect(best).toEqual({ email: "jobs@obfusco.com", source: "obfuscated" });
  });

  it("returns null when no candidates are given", () => {
    expect(pickBestEmail([])).toBeNull();
  });

  it("ranks mailto above regex above obfuscated when all are present for different addresses without a hiring-relevant one", () => {
    const candidates = [
      { email: "a@generic.com", source: "obfuscated" as const },
      { email: "b@generic.com", source: "regex" as const },
      { email: "c@generic.com", source: "mailto" as const },
    ];
    expect(pickBestEmail(candidates)).toEqual({ email: "c@generic.com", source: "mailto" });
  });

  it("does not mistake a retina-asset filename in inline CSS/JS for an email", () => {
    // Regression: cheerio's .text() includes <script>/<style> content, and
    // "logo@2x.png" is syntactically indistinguishable from an email address
    // to the plain regex scanner.
    const html = `
      <html><body>
        <script>var bg = "sprite@3x.svg"; console.log("cache@1x.webp");</script>
        <style>.logo { background-image: url(logo@2x.png); }</style>
        <p>Reach us at hello@realcompany.com</p>
      </body></html>
    `;
    const candidates = extractEmails(html);
    expect(candidates).toContainEqual({ email: "hello@realcompany.com", source: "regex" });
    expect(candidates.some((c) => c.email.includes("@2x") || c.email.includes("@3x") || c.email.includes("@1x"))).toBe(
      false
    );
  });

  it("rejects file-extension-shaped TLDs even outside script/style tags", () => {
    const html = `<html><body><p>See asset icon@2x.png for reference, or email hello@real.com</p></body></html>`;
    const candidates = extractEmails(html);
    expect(candidates).toContainEqual({ email: "hello@real.com", source: "regex" });
    expect(candidates.some((c) => c.email === "icon@2x.png")).toBe(false);
  });
});

describe("extractors/phone", () => {
  it("classifies a 10-digit number starting 6-9 as mobile", () => {
    expect(classifyDigits("9876543210")).toEqual({
      raw: "9876543210",
      digits: "9876543210",
      kind: "mobile",
    });
  });

  it("classifies a mobile number with a leading 91 country code", () => {
    expect(classifyDigits("919876543210")).toEqual({
      raw: "919876543210",
      digits: "9876543210",
      kind: "mobile",
    });
  });

  it("classifies a number with a recognized STD code as landline", () => {
    expect(classifyDigits("02212345678")).toEqual({
      raw: "02212345678",
      digits: "02212345678",
      kind: "landline",
    });
  });

  it("drops ambiguous/unparseable numbers instead of guessing", () => {
    expect(classifyDigits("12345")).toBeNull();
    expect(classifyDigits("5876543210")).toBeNull(); // 10 digits but starts with 5
    expect(classifyDigits("09991234567")).toBeNull(); // leading 0 but not a recognized STD code
  });

  it("extracts and classifies both a tel: mobile link and a footer landline", () => {
    const html = `
      <html><body>
        <a href="tel:+919876543210">Call us</a>
        <footer>Office: 022-4321 8765</footer>
      </body></html>
    `;
    const candidates = extractPhones(html);
    const { mobile, landline } = pickPrimaryPhones(candidates);
    expect(mobile).toBe("9876543210");
    expect(landline).toBe("02243218765");
  });

  it("does not mistake a 10-digit ID inside an inline script for a mobile number", () => {
    // Regression: a numeric literal in inline JS (analytics event ID, a/b
    // test bucket, etc.) that happens to be 10 digits starting 6-9 is
    // syntactically indistinguishable from a real mobile number.
    const html = `
      <html><body>
        <script>trackEvent(9876543210);</script>
        <footer>Call: 022-4321 8765</footer>
      </body></html>
    `;
    const { mobile, landline } = pickPrimaryPhones(extractPhones(html));
    expect(mobile).toBeNull();
    expect(landline).toBe("02243218765");
  });
});

describe("extractors/careers", () => {
  it("detects ATS by URL pattern", () => {
    expect(detectATS("https://boards.greenhouse.io/fixtureco")).toBe("greenhouse");
    expect(detectATS("https://jobs.lever.co/fixtureco")).toBe("lever");
    expect(detectATS("https://apply.workable.com/fixtureco")).toBe("workable");
    expect(detectATS("https://jobs.ashbyhq.com/fixtureco")).toBe("ashby");
    expect(detectATS("https://fixtureco.bamboohr.com/jobs")).toBe("bamboohr");
    expect(detectATS("https://fixtureco.com/about")).toBe("none");
  });

  it("finds a careers link on the homepage and resolves it to an absolute URL", () => {
    const html = `
      <html><body>
        <nav>
          <a href="/about">About</a>
          <a href="/careers">Careers</a>
        </nav>
      </body></html>
    `;
    const link = findCareersLink(html, "https://fixtureco.com");
    expect(link).toBe("https://fixtureco.com/careers");
  });

  it("finds a direct ATS-hosted careers link even without careers-like text", () => {
    const html = `<html><body><a href="https://boards.greenhouse.io/fixtureco">Join the team</a></body></html>`;
    const link = findCareersLink(html, "https://fixtureco.com");
    expect(link).toBe("https://boards.greenhouse.io/fixtureco");
  });

  it("prefers a real /careers link over an earlier incidental 'hiring' mention", () => {
    // Regression: "first match wins" used to lock onto the earlier, worse
    // match and never even look at the real careers link later on the page.
    const html = `
      <html><body>
        <nav>
          <a href="/culture">We're always hiring passionate people!</a>
        </nav>
        <footer>
          <a href="/careers">Careers</a>
        </footer>
      </body></html>
    `;
    const link = findCareersLink(html, "https://fixtureco.com");
    expect(link).toBe("https://fixtureco.com/careers");
  });

  it("prefers an ATS-hosted link over an earlier incidental keyword match", () => {
    const html = `
      <html><body>
        <nav><a href="/blog/hiring-trends-2026">Hiring Trends for 2026</a></nav>
        <footer><a href="https://boards.greenhouse.io/fixtureco">Open roles</a></footer>
      </body></html>
    `;
    const link = findCareersLink(html, "https://fixtureco.com");
    expect(link).toBe("https://boards.greenhouse.io/fixtureco");
  });

  it("returns null when no careers link is present", () => {
    const html = `<html><body><a href="/about">About</a><a href="/pricing">Pricing</a></body></html>`;
    expect(findCareersLink(html, "https://fixtureco.com")).toBeNull();
  });

  it("extracts job titles from a Greenhouse-style careers page", () => {
    const html = fixture("careers-greenhouse.html");
    const titles = extractJobTitles(html, "greenhouse");
    expect(titles).toEqual([
      "Senior Backend Engineer",
      "Frontend Engineer (React)",
      "Product Designer",
    ]);
  });

  it("does not treat a site's nav/footer links as job titles when there's no recognized ATS", () => {
    // Regression: a real careers page with no ATS returned 20+ "job titles"
    // that were actually every nav + footer link on the page.
    const html = `
      <html><body>
        <nav>
          <ul>
            <li><a href="/">Home</a></li>
            <li><a href="/about">About</a></li>
            <li><a href="/careers">Careers</a></li>
            <li><a href="/blog">Blogs</a></li>
          </ul>
        </nav>
        <main><h1>Careers</h1><p>We're not currently hiring, check back soon.</p></main>
        <footer>
          <ul>
            <li><a href="/terms">Terms &amp; Conditions</a></li>
            <li><a href="/privacy">Privacy Policy</a></li>
          </ul>
        </footer>
      </body></html>
    `;
    expect(extractJobTitles(html, "none")).toEqual([]);
  });

  it("still extracts titles from a specifically-scoped job-listing container with no ATS", () => {
    const html = `
      <html><body>
        <nav><ul><li><a href="/">Home</a></li></ul></nav>
        <div class="job-listing">
          <a href="/jobs/1">Backend Engineer</a>
          <a href="/jobs/2">QA Analyst</a>
        </div>
      </body></html>
    `;
    expect(extractJobTitles(html, "none")).toEqual(["Backend Engineer", "QA Analyst"]);
  });
});

describe("extractors/techStack", () => {
  it("detects Next.js from __NEXT_DATA__", () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>`;
    expect(detectTechStack(html)).toContain("Next.js");
  });

  it("detects Angular from ng-version attribute", () => {
    const html = `<html><body><app-root ng-version="17.0.0"></app-root></body></html>`;
    expect(detectTechStack(html)).toContain("Angular");
  });

  it("detects Vue from data-v- scoped attributes", () => {
    const html = `<html><body><div data-v-7a1b2c3d>Hello</div></body></html>`;
    expect(detectTechStack(html)).toContain("Vue");
  });

  it("detects React from data-reactroot", () => {
    const html = `<html><body><div data-reactroot="">Hello</div></body></html>`;
    expect(detectTechStack(html)).toContain("React");
  });

  it("returns an empty list for a plain static page", () => {
    const html = `<html><body><h1>Just some HTML</h1><p>No frameworks here.</p></body></html>`;
    expect(detectTechStack(html)).toEqual([]);
  });

  it("joins detected names into a comma-separated string", () => {
    expect(techStackToString(["React", "Next.js"])).toBe("React,Next.js");
    expect(techStackToString([])).toBe("");
  });
});
