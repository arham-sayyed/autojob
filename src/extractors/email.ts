import * as cheerio from "cheerio";

export type EmailExtractionSource = "mailto" | "jsonld" | "footer" | "regex" | "obfuscated";
export type StorageEmailSource = "mailto" | "footer" | "regex" | "jsonld" | "none";

export interface EmailCandidate {
  email: string;
  source: EmailExtractionSource;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const VALID_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const OBFUSCATION_PATTERNS: RegExp[] = [
  // name [at] domain [dot] com  /  name (at) domain (dot) com
  /([a-zA-Z0-9._%+-]+)\s*[[(]\s*at\s*[\])]\s*([a-zA-Z0-9.-]+)\s*[[(]\s*dot\s*[\])]\s*([a-zA-Z]{2,})/gi,
  // name AT domain DOT com
  /([a-zA-Z0-9._%+-]+)\s+at\s+([a-zA-Z0-9.-]+)\s+dot\s+([a-zA-Z]{2,})/gi,
];

// Rank used to pick the single best email when several were found for a
// company: mailto > JSON-LD > footer regex > plain regex > obfuscated.
const RANK: Record<EmailExtractionSource, number> = {
  mailto: 5,
  jsonld: 4,
  footer: 3,
  regex: 2,
  obfuscated: 1,
};

const HIRING_PREFIXES = [
  "careers",
  "career",
  "hr",
  "jobs",
  "job",
  "recruit",
  "recruiting",
  "talent",
  "hiring",
];

function isValidEmail(email: string): boolean {
  return VALID_EMAIL_REGEX.test(email);
}

function isHiringRelevant(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return HIRING_PREFIXES.some((p) => local === p || local.startsWith(p));
}

function extractMailto($: cheerio.CheerioAPI): EmailCandidate[] {
  const results: EmailCandidate[] = [];
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const raw = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (isValidEmail(raw)) {
      results.push({ email: raw, source: "mailto" });
    }
  });
  return results;
}

function collectEmailsFromJson(value: unknown, out: EmailCandidate[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v) => collectEmailsFromJson(v, out));
    return;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase() === "email" && typeof v === "string" && isValidEmail(v)) {
        out.push({ email: v.toLowerCase(), source: "jsonld" });
      } else {
        collectEmailsFromJson(v, out);
      }
    }
  }
}

function extractJsonLd($: cheerio.CheerioAPI): EmailCandidate[] {
  const results: EmailCandidate[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      collectEmailsFromJson(JSON.parse(raw), results);
    } catch {
      // Not valid JSON — skip rather than guess.
    }
  });
  return results;
}

function extractRegexAndFooter($: cheerio.CheerioAPI): EmailCandidate[] {
  const results: EmailCandidate[] = [];

  const footerText = $("footer, [class*='footer' i], [id*='footer' i]").text();
  const footerSet = new Set<string>();
  for (const m of footerText.match(EMAIL_REGEX) ?? []) {
    const email = m.toLowerCase();
    if (isValidEmail(email) && !footerSet.has(email)) {
      footerSet.add(email);
      results.push({ email, source: "footer" });
    }
  }

  const bodyText = $("body").text();
  const seen = new Set<string>();
  for (const m of bodyText.match(EMAIL_REGEX) ?? []) {
    const email = m.toLowerCase();
    if (isValidEmail(email) && !footerSet.has(email) && !seen.has(email)) {
      seen.add(email);
      results.push({ email, source: "regex" });
    }
  }

  return results;
}

function extractObfuscated(html: string): EmailCandidate[] {
  const results: EmailCandidate[] = [];
  const text = html.replace(/<[^>]+>/g, " ");
  for (const pattern of OBFUSCATION_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const email = `${match[1]}@${match[2]}.${match[3]}`.toLowerCase();
      if (isValidEmail(email)) {
        results.push({ email, source: "obfuscated" });
      }
    }
  }
  return results;
}

export function extractEmails(html: string): EmailCandidate[] {
  const $ = cheerio.load(html);
  return [
    ...extractMailto($),
    ...extractRegexAndFooter($),
    ...extractJsonLd($),
    ...extractObfuscated(html),
  ];
}

export function pickBestEmail(candidates: EmailCandidate[]): EmailCandidate | null {
  if (candidates.length === 0) return null;

  const byEmail = new Map<string, EmailCandidate>();
  for (const c of candidates) {
    const key = c.email.toLowerCase();
    const existing = byEmail.get(key);
    if (!existing || RANK[c.source] > RANK[existing.source]) {
      byEmail.set(key, { email: key, source: c.source });
    }
  }
  const unique = [...byEmail.values()];

  const hiring = unique.filter((c) => isHiringRelevant(c.email));
  const pool = hiring.length > 0 ? hiring : unique;

  pool.sort((a, b) => RANK[b.source] - RANK[a.source]);
  return pool[0] ?? null;
}

export function toStorageEmailSource(source: EmailExtractionSource): StorageEmailSource {
  return source === "obfuscated" ? "regex" : source;
}
