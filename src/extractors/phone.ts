import * as cheerio from "cheerio";

export type PhoneKind = "mobile" | "landline";

export interface PhoneCandidate {
  raw: string;
  digits: string;
  kind: PhoneKind;
}

// Recognized Indian STD (area) codes, always including the leading 0 as
// dialled domestically (e.g. Mumbai 022, Delhi 011, Bangalore 080).
const STD_CODES = [
  "011", // Delhi
  "022", // Mumbai
  "033", // Kolkata
  "044", // Chennai
  "080", // Bangalore
  "020", // Pune
  "040", // Hyderabad
  "079", // Ahmedabad
  "0120", // Noida
  "0124", // Gurugram
  "0141", // Jaipur
  "0172", // Chandigarh
  "0261", // Surat
  "0422", // Coimbatore
  "0484", // Kochi
  "0522", // Lucknow
  "0712", // Nagpur
  "0731", // Indore
  "0755", // Bhopal
  "0821", // Mysore
  "0836", // Hubli
];

const MOBILE_REGEX = /(?<!\d)[6-9]\d{9}(?!\d)/g;
const PHONE_ISH_REGEX = /[+]?\d[\d\s().-]{7,16}\d/g;

function stripToDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Classifies a digits-only phone number. Returns null for anything that
 * doesn't cleanly match a mobile or a recognized-STD-code landline pattern —
 * ambiguous/unparseable numbers are dropped, not guessed.
 */
export function classifyDigits(rawDigits: string): PhoneCandidate | null {
  let mobileCandidate = rawDigits;
  if (mobileCandidate.length === 12 && mobileCandidate.startsWith("91")) {
    mobileCandidate = mobileCandidate.slice(2);
  }
  if (/^[6-9]\d{9}$/.test(mobileCandidate)) {
    return { raw: rawDigits, digits: mobileCandidate, kind: "mobile" };
  }

  if (rawDigits.startsWith("0")) {
    const sortedCodes = [...STD_CODES].sort((a, b) => b.length - a.length);
    for (const code of sortedCodes) {
      if (rawDigits.startsWith(code)) {
        const rest = rawDigits.slice(code.length);
        if (rest.length >= 6 && rest.length <= 8) {
          return { raw: rawDigits, digits: rawDigits, kind: "landline" };
        }
      }
    }
  }

  return null;
}

function extractTel($: cheerio.CheerioAPI): string[] {
  const results: string[] = [];
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    results.push(href.replace(/^tel:/i, ""));
  });
  return results;
}

function extractFromText(text: string): string[] {
  return [...(text.match(MOBILE_REGEX) ?? []), ...(text.match(PHONE_ISH_REGEX) ?? [])];
}

export function extractPhones(html: string): PhoneCandidate[] {
  const $ = cheerio.load(html);
  const rawStrings = [
    ...extractTel($),
    ...extractFromText($("footer, [class*='footer' i], [id*='footer' i]").text()),
    ...extractFromText($("body").text()),
  ];

  const seen = new Set<string>();
  const results: PhoneCandidate[] = [];
  for (const raw of rawStrings) {
    const digits = stripToDigits(raw);
    if (!digits) continue;
    const candidate = classifyDigits(digits);
    if (!candidate || seen.has(candidate.digits)) continue;
    seen.add(candidate.digits);
    results.push(candidate);
  }
  return results;
}

export function pickPrimaryPhones(candidates: PhoneCandidate[]): {
  mobile: string | null;
  landline: string | null;
} {
  return {
    mobile: candidates.find((c) => c.kind === "mobile")?.digits ?? null,
    landline: candidates.find((c) => c.kind === "landline")?.digits ?? null,
  };
}
