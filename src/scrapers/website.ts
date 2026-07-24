import * as cheerio from "cheerio";
import puppeteer, { Browser } from "puppeteer";
import { logger, writeLog } from "../utils/logger";
import { createRateLimiter } from "../utils/rateLimiter";

export interface ScrapedPage {
  url: string;
  html: string;
}

// Matched against a link's path *and* its visible anchor text — sites phrase
// these very differently ("Get in touch" -> /contact, "Meet the team" -> /about-us).
const LINK_KEYWORD_PATTERNS: RegExp[] = [
  /\babout(?:[-\s]?us)?\b/i,
  /\bcontact(?:[-\s]?us)?\b/i,
  /\bcareers?\b/i,
  /\bjobs?\b/i,
  /\bteam\b/i,
  /\bjoin[-\s]?us\b/i,
  /\bjoin[-\s]?our[-\s]?team\b/i,
  /\bwork[-\s]?with[-\s]?us\b/i,
  /\bwe'?re[-\s]?hiring\b/i,
  /\bhiring\b/i,
  /\bopen[-\s]?positions?\b/i,
  /\bvacanc(?:y|ies)\b/i,
];

const MAX_MATCHED_LINKS = 8;

// A link whose *entire* last path segment is one of these is almost
// certainly the real page; anything else matching LINK_KEYWORD_PATTERNS
// (e.g. a blog post slug containing "team" or "jobs") is a weaker signal.
const EXACT_SEGMENT_MATCHES = new Set([
  "about",
  "about-us",
  "aboutus",
  "contact",
  "contact-us",
  "contactus",
  "careers",
  "career",
  "jobs",
  "team",
  "our-team",
  "meet-the-team",
  "join-us",
  "work-with-us",
]);

const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 4; // 1 initial attempt + 3 retries
const USER_AGENT = "Mozilla/5.0 (compatible; JobOutreachBot/1.0; +personal-job-search-tool)";

const crawlLimiter = createRateLimiter({ minDelayMs: 800, maxDelayMs: 2000 });

interface FetchResult {
  ok: boolean;
  status?: number;
  html?: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetries(url: string): Promise<FetchResult> {
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url, TIMEOUT_MS);
      if (res.status === 404) {
        return { ok: false, status: 404, error: "404 Not Found" };
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
      } else {
        const html = await res.text();
        return { ok: true, status: res.status, html };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1000ms, 2000ms
    }
  }

  return { ok: false, error: lastError };
}

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

async function fetchWithPuppeteer(url: string): Promise<FetchResult> {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setUserAgent(USER_AGENT);
      await page.goto(url, { waitUntil: "networkidle2", timeout: TIMEOUT_MS * 2 });
      const html = await page.content();
      return { ok: true, html };
    } finally {
      await page.close();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Heuristic: near-empty visible body text plus external scripts usually means content is client-rendered. */
function looksJsHeavy($: cheerio.CheerioAPI): boolean {
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const hasScripts = $("script[src]").length > 0;
  return bodyText.length < 200 && hasScripts;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function logFetchFailure(url: string, reason: string): void {
  writeLog("fetch-failures", `${url} — ${reason}`);
  logger.warn(`[website] failed to fetch ${url}: ${reason}`);
}

function logFetchSuccess(url: string, viaFallback: boolean): void {
  writeLog("fetch-successes", `${url}${viaFallback ? " (puppeteer fallback)" : ""}`);
}

async function fetchPageWithFallback(url: string): Promise<string | null> {
  const result = await fetchWithRetries(url);
  if (!result.ok || !result.html) {
    logFetchFailure(url, result.error ?? `HTTP ${result.status ?? "unknown"}`);
    return null;
  }

  let html = result.html;
  let viaFallback = false;
  const $ = cheerio.load(html);
  if (looksJsHeavy($)) {
    const rendered = await fetchWithPuppeteer(url);
    if (rendered.ok && rendered.html) {
      html = rendered.html;
      viaFallback = true;
    } else {
      logFetchFailure(url, `puppeteer fallback failed: ${rendered.error ?? "unknown error"}`);
    }
  }

  logFetchSuccess(url, viaFallback);
  return html;
}

/**
 * Fetches a single arbitrary page (e.g. an external ATS-hosted careers
 * board found via findCareersLink), rate-limited the same as crawlWebsite.
 */
export async function fetchSinglePage(url: string): Promise<string | null> {
  return crawlLimiter.run(() => fetchPageWithFallback(url));
}

/**
 * Scans the homepage's own links (href *and* anchor text) for ones that
 * look like about/contact/careers/team pages, rather than guessing fixed
 * paths that usually don't exist. Stays on the same origin — external ATS
 * links are handled separately by extractors/careers.ts + fetchSinglePage.
 *
 * Scores every match and takes the best MAX_MATCHED_LINKS rather than
 * whichever appear first in DOM order: a "Latest from our blog" section
 * earlier on the page can easily contain more than 8 posts whose slugs
 * incidentally match (e.g. "5 jobs of the future"), which would otherwise
 * exhaust the link budget before the real footer nav is even reached.
 */
export function findMatchingLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;
  const candidates = new Map<string, number>(); // url -> score

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;

    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (resolved.origin !== origin) return;
    resolved.hash = "";

    const text = $(el).text().trim();
    const haystack = `${resolved.pathname} ${text}`;
    const isMatch = LINK_KEYWORD_PATTERNS.some((pattern) => pattern.test(haystack));
    if (!isMatch) return;

    const lastSegment = resolved.pathname.replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";
    const score = EXACT_SEGMENT_MATCHES.has(lastSegment) ? 2 : 1;

    const key = resolved.toString();
    const existing = candidates.get(key);
    if (existing === undefined || score > existing) {
      candidates.set(key, score);
    }
  });

  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MATCHED_LINKS)
    .map(([url]) => url);
}

/**
 * Fetches the homepage, then follows only the links on it that actually
 * look like about/contact/careers/team pages (via findMatchingLinks) —
 * instead of blindly guessing a fixed list of paths that usually 404.
 * Skips failures quickly and logs them separately from successes. Falls
 * back to a headless Puppeteer render for pages that look client-rendered.
 */
export async function crawlWebsite(baseUrl: string): Promise<ScrapedPage[]> {
  const origin = normalizeBaseUrl(baseUrl);
  const homeUrl = new URL("/", origin).toString();

  const homeHtml = await crawlLimiter.run(() => fetchPageWithFallback(homeUrl));
  if (!homeHtml) return [];

  const results: ScrapedPage[] = [{ url: homeUrl, html: homeHtml }];

  const links = findMatchingLinks(homeHtml, homeUrl);
  for (const url of links) {
    const html = await crawlLimiter.run(() => fetchPageWithFallback(url));
    if (html) {
      results.push({ url, html });
    }
  }

  return results;
}
