import * as cheerio from "cheerio";
import puppeteer, { Browser } from "puppeteer";
import { logger, writeLog } from "../utils/logger";
import { createRateLimiter } from "../utils/rateLimiter";

export interface ScrapedPage {
  url: string;
  html: string;
}

const PATHS_TO_TRY = [
  "/",
  "/about",
  "/contact",
  "/careers",
  "/jobs",
  "/team",
  "/join-us",
  "/work-with-us",
];

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
 * Crawls a company's common informational pages (home, about, contact,
 * careers, ...), skipping 404s and logging failures separately from
 * successes. Falls back to a headless Puppeteer render for pages that look
 * client-rendered (near-empty static HTML with external scripts).
 */
export async function crawlWebsite(baseUrl: string): Promise<ScrapedPage[]> {
  const origin = normalizeBaseUrl(baseUrl);
  const results: ScrapedPage[] = [];

  for (const relativePath of PATHS_TO_TRY) {
    const url = new URL(relativePath, origin).toString();

    const html = await crawlLimiter.run(() => fetchPageWithFallback(url));

    if (html) {
      results.push({ url, html });
    }
  }

  return results;
}
