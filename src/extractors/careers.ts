import * as cheerio from "cheerio";

export type ATSName = "greenhouse" | "lever" | "workable" | "ashby" | "bamboohr" | "none";

const ATS_PATTERNS: Array<{ name: ATSName; pattern: RegExp }> = [
  { name: "greenhouse", pattern: /greenhouse\.io/i },
  { name: "lever", pattern: /jobs\.lever\.co/i },
  { name: "workable", pattern: /workable\.com/i },
  { name: "ashby", pattern: /ashbyhq\.com/i },
  { name: "bamboohr", pattern: /bamboohr\.com/i },
];

const CAREERS_KEYWORDS = [
  "careers",
  "career",
  "jobs",
  "join us",
  "join-us",
  "work with us",
  "work-with-us",
  "we're hiring",
  "hiring",
  "open positions",
  "vacancies",
];

export function detectATS(url: string): ATSName {
  for (const { name, pattern } of ATS_PATTERNS) {
    if (pattern.test(url)) return name;
  }
  return "none";
}

function resolveUrl(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Scans a page's links for one that looks like the careers/jobs page —
 * either an explicit ATS-hosted link, or an in-page link whose text/href
 * matches common careers-page phrasing.
 */
export function findCareersLink(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);
  let found: string | null = null;

  $("a[href]").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("#")) return;
    const text = $(el).text().trim().toLowerCase();
    const hrefLower = href.toLowerCase();

    const isATSLink = ATS_PATTERNS.some(({ pattern }) => pattern.test(hrefLower));
    const matchesKeyword = CAREERS_KEYWORDS.some(
      (k) => text.includes(k) || hrefLower.includes(k.replace(/\s+/g, "-")) || hrefLower.includes(k.replace(/\s+/g, ""))
    );

    if (isATSLink || matchesKeyword) {
      found = resolveUrl(baseUrl, href);
    }
  });

  return found;
}

function textList($: cheerio.CheerioAPI, selector: string): string[] {
  return $(selector)
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 0 && t.length < 120);
}

function extractGenericTitles($: cheerio.CheerioAPI): string[] {
  const candidates = [
    ...textList($, "[class*='opening'] a, [class*='opening'] h3, [class*='opening'] h4"),
    ...textList($, "[class*='job-title'], [class*='posting-title'], [data-ui='job-title']"),
    ...textList($, "li a"),
  ];
  return candidates;
}

/**
 * Extracts visible job titles from a careers/jobs page. Uses ATS-specific
 * markup where recognized, otherwise falls back to a generic heuristic.
 */
export function extractJobTitles(html: string, ats: ATSName = "none"): string[] {
  const $ = cheerio.load(html);

  let titles: string[];
  switch (ats) {
    case "greenhouse":
      titles = textList($, ".opening a, [class*='opening'] a");
      break;
    case "lever":
      titles = textList($, ".posting-title, .posting a h5, [class*='posting-title']");
      break;
    case "workable":
      titles = textList($, "[data-ui='job-title'], [class*='job-title']");
      break;
    case "ashby":
      titles = textList($, "[class*='job-board__job-posting-title'], [class*='job-posting-title']");
      break;
    case "bamboohr":
      titles = textList($, "[class*='job-title'], .BambooHR-ATS-Jobs-Item a");
      break;
    default:
      titles = extractGenericTitles($);
  }

  return [...new Set(titles.map((t) => t.trim()).filter(Boolean))];
}
