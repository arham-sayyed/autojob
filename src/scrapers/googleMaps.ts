import puppeteer, { Browser, Page } from "puppeteer";
import { config } from "../config";
import { logger } from "../utils/logger";
import { createRateLimiter } from "../utils/rateLimiter";

export interface MapsResult {
  name: string;
  website: string | null;
  address: string | null;
  rating: number | null;
  phone: string | null;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const NAV_TIMEOUT_MS = 30000;
const SCROLL_ROUNDS = 6;

// Scraping Google Maps is against Google's ToS — this is deliberately kept
// low-volume (a handful of search-term/city pairs, run occasionally) with
// randomized delays between every action, never a tight loop.
const searchLimiter = createRateLimiter({ minDelayMs: 2000, maxDelayMs: 5000 });

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sponsored/ad listings can surface a Google ad-click redirect
 * (e.g. "/aclk?sa=l&ai=...") in the "Website" slot instead of the business's
 * real site — reject anything that isn't a plausible external http(s) URL.
 */
export function isPlausibleWebsite(url: string | null): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  if (/(^|\.)google\.[a-z.]+$/i.test(parsed.hostname)) return false;
  if (/(^|\.)gstatic\.com$/i.test(parsed.hostname)) return false;
  if (parsed.pathname.startsWith("/aclk")) return false;
  return true;
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

async function scrollResultsFeed(page: Page): Promise<void> {
  const feedSelector = 'div[role="feed"]';
  const feed = await page.waitForSelector(feedSelector, { timeout: NAV_TIMEOUT_MS }).catch(() => null);
  if (!feed) return;

  for (let i = 0; i < SCROLL_ROUNDS; i++) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollTop = el.scrollHeight;
    }, feedSelector);
    await randomDelay(2000, 5000);
  }
}

/**
 * Extracts listing cards from the currently loaded results feed.
 *
 * Google Maps' DOM uses auto-generated, non-semantic class names that
 * Google changes without notice — these selectors (verified against a live
 * search) are inherently best-effort and may need updating over time.
 */
async function extractListings(page: Page): Promise<MapsResult[]> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div[role="article"]'));
    return cards.map((card) => {
      const nameEl = card.querySelector(".qBF1Pd");
      const name =
        (nameEl?.textContent || "").trim() ||
        card.querySelector("a.hfpxzc")?.getAttribute("aria-label") ||
        "";

      const ratingEl = card.querySelector(".MW4etd");
      const ratingText = (ratingEl?.textContent || "").trim();
      const parsedRating = ratingText ? parseFloat(ratingText) : NaN;
      const rating = Number.isNaN(parsedRating) ? null : parsedRating;

      const phoneEl = card.querySelector(".UsdlK");
      const phone = (phoneEl?.textContent || "").trim() || null;

      const websiteEl = card.querySelector('a[data-value="Website"]');
      const website = websiteEl ? websiteEl.getAttribute("href") : null;

      let address: string | null = null;
      const infoDivs = Array.from(card.querySelectorAll(".W4Efsd"));
      for (const div of infoDivs) {
        if (address) break; // category+address is always the first qualifying row
        if (div.querySelector(".MW4etd")) continue; // rating row, not address
        const spans = Array.from(div.querySelectorAll("span"))
          .map((s) => (s.textContent || "").trim())
          .filter((t) => t && t !== "·");
        const joined = spans.join(" ");
        const looksLikeHours = /\b(open|opens|closed|closes|hours)\b/i.test(joined) || /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(joined);
        if (looksLikeHours) continue;
        if (phone && spans.some((t) => t.includes(phone))) continue;
        if (spans.length >= 2) {
          address = spans[spans.length - 1];
        }
      }

      return { name, website, address, rating, phone };
    });
  });
}

/** Searches Google Maps for one (searchTerm, city) pair and returns deduped listings. */
export async function searchGoogleMaps(searchTerm: string, city: string): Promise<MapsResult[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(USER_AGENT);
    const query = encodeURIComponent(`${searchTerm} in ${city}`);
    logger.info(`[googleMaps] searching "${searchTerm}" in "${city}"`);

    await page.goto(`https://www.google.com/maps/search/${query}`, {
      waitUntil: "networkidle2",
      timeout: NAV_TIMEOUT_MS,
    });
    await randomDelay(2000, 5000);

    await scrollResultsFeed(page);

    const listings = await extractListings(page);
    const seen = new Set<string>();
    const deduped: MapsResult[] = [];
    for (const raw of listings) {
      if (!raw.name) continue;
      const website = isPlausibleWebsite(raw.website) ? raw.website : null;
      const key = `${raw.name.toLowerCase()}|${(website ?? "").toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({ ...raw, website });
    }

    logger.info(`[googleMaps] found ${deduped.length} listing(s) for "${searchTerm}" in "${city}"`);
    return deduped;
  } finally {
    await page.close();
  }
}

/** Runs every (searchTerm, city) pair from config, one at a time with jittered delays. */
export async function discoverCompanies(
  searchTerms: string[] = config.searchTerms,
  cities: string[] = config.searchCities
): Promise<MapsResult[]> {
  const all: MapsResult[] = [];
  // searchGoogleMaps() only dedupes within a single search — overlapping
  // search terms (e.g. "software company" and "SaaS company" in the same
  // city) surface many of the same businesses, so dedupe across the whole
  // run too, otherwise "found"/"upserted" counts are inflated with repeats.
  const seen = new Set<string>();

  for (const city of cities) {
    for (const term of searchTerms) {
      await searchLimiter.run(async () => {
        try {
          const results = await searchGoogleMaps(term, city);
          for (const result of results) {
            const key = `${result.name.toLowerCase()}|${(result.website ?? "").toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            all.push(result);
          }
        } catch (err) {
          logger.error(
            `[googleMaps] search failed for "${term}" in "${city}": ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      });
    }
  }

  return all;
}
