import Groq from "groq-sdk";
import * as cheerio from "cheerio";
import { config } from "../config";
import { createRateLimiter } from "../utils/rateLimiter";

const MODEL = "llama-3.3-70b-versatile";

let client: Groq | null = null;
function getClient(): Groq {
  if (!client) {
    client = new Groq({ apiKey: config.groqApiKey });
  }
  return client;
}

// Groq's on-demand tier caps this model at 1K requests/minute. Without this,
// a batch stage (e.g. groq-draft looping over ~90 companies) fires every
// request back-to-back the moment one fails fast, which can burst well past
// that RPM cap on its own — independent of any daily token budget.
const groqLimiter = createRateLimiter({ minDelayMs: 500, maxDelayMs: 1500 });

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface CompanyContext {
  companyName: string;
  website: string;
  summary: string;
  jobTitles: string[];
}

export interface FitScoreInput {
  jobTitles: string[];
  ats: string; // "none" when no ATS/careers page was detected
  techStack: string[];
  pageText: string;
}

async function chat(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  return groqLimiter.run(async () => {
    const completion = await getClient().chat.completions.create({
      model: MODEL,
      temperature: 0.6,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return (completion.choices[0]?.message?.content ?? "").trim();
  });
}

function htmlToPlainText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

/**
 * Parses the model's "Subject: ...\n\nBody..." response. Models regularly
 * ignore the "respond with exactly" instruction — adding a preamble
 * ("Here's the email:") or wrapping the reply in a markdown code fence — so
 * this tolerates both instead of anchoring to the very start of the string
 * (which would otherwise dump the whole raw response, "Subject:" line
 * included, into the email body with a generic fallback subject).
 */
export function parseSubjectBody(raw: string, fallbackSubject: string): EmailDraft {
  const cleaned = raw
    .trim()
    .replace(/^```[a-z]*\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  // `m` flag: match "Subject:" at the start of *any* line, not just index 0,
  // so a preamble before it is simply excluded rather than breaking the parse.
  const match = cleaned.match(/^Subject:\s*(.+?)\s*\n+([\s\S]+)$/im);
  if (match) {
    return { subject: match[1].trim(), body: match[2].trim() };
  }
  return { subject: fallbackSubject, body: cleaned };
}

/** Summarizes a company's scraped page HTML in 2-3 plain sentences. */
export async function summarize(companyHtml: string): Promise<string> {
  const text = htmlToPlainText(companyHtml).slice(0, 6000);
  const system =
    "You summarize company websites for a job seeker. Output 2-3 plain sentences, " +
    "no markdown, no headers, no placeholders, nothing else.";
  const user = `Summarize what this company does, based on this website text:\n\n${text}`;
  return chat(system, user, 200);
}

// The stack the outreach is being sent on behalf of — used only for the
// "matches your stack" scoring bonus below.
const MY_STACK = ["Node", "Node.js", "TypeScript", "JavaScript", "React", "Next.js"];

/**
 * Deterministic, rules-based fit score (no AI call): hiring +25, remote +20,
 * +10 per matched stack technology, junior/internship-friendly +15.
 */
export function scoreFit(input: FitScoreInput): number {
  let score = 0;

  const isHiring = input.ats !== "none" || input.jobTitles.length > 0;
  if (isHiring) score += 25;

  const isRemote = /\bremote\b/i.test(input.pageText);
  if (isRemote) score += 20;

  const matchedStack = MY_STACK.filter((tech) =>
    input.techStack.some((t) => t.toLowerCase() === tech.toLowerCase())
  );
  score += matchedStack.length * 10;

  const juniorText = [...input.jobTitles, input.pageText].join(" ");
  const isJuniorFriendly = /\b(intern|internship|junior|entry[- ]level|fresher)\b/i.test(juniorText);
  if (isJuniorFriendly) score += 15;

  return score;
}

/** Drafts a personalized cold-outreach email, ≤150 words, no unfilled placeholders. */
export async function draftEmail(
  company: CompanyContext,
  resumeHighlights: string
): Promise<EmailDraft> {
  const system = [
    "You write short, personalized cold outreach emails from a job seeker to a company.",
    "Rules:",
    "- Never leave placeholders like [Company Name] unfilled — use the real company name given.",
    "- Keep the email body under 150 words.",
    "- Reference at least one concrete detail about the company from the context given (not generic flattery).",
    "- No markdown formatting, plain email text only.",
    '- Sign off with just "Best," (no name — the sender will add their own).',
    '- Respond with exactly: a first line starting with "Subject: ", a blank line, then the email body. Nothing else.',
  ].join("\n");

  const user = [
    `Company name: ${company.companyName}`,
    `Website: ${company.website}`,
    `What they do: ${company.summary || "Not available — write a warmer, more general opening."}`,
    company.jobTitles.length > 0
      ? `Open roles seen on their site: ${company.jobTitles.join(", ")}`
      : "No specific open roles were found — pitch general interest in joining, not a specific listing.",
    `My background/resume highlights: ${resumeHighlights}`,
    "Write a cold outreach email expressing interest in working there, per the rules above.",
  ].join("\n");

  const raw = await chat(system, user, 500);
  return parseSubjectBody(raw, `Interested in opportunities at ${company.companyName}`);
}

/** Drafts a short, polite follow-up email, ≤100 words, no unfilled placeholders. */
export async function draftFollowUp(company: CompanyContext): Promise<EmailDraft> {
  const system = [
    "You write brief, polite follow-up emails after a job seeker's first outreach email got no reply.",
    "Rules:",
    "- Never leave placeholders unfilled — use the real company name given.",
    "- Keep the body under 100 words, and make clear this is a gentle follow-up to a previous email.",
    "- Reference one concrete detail about the company again, ideally a different angle than a generic bump.",
    "- No markdown formatting, plain email text only.",
    '- Sign off with just "Best,".',
    '- Respond with exactly: a first line starting with "Subject: ", a blank line, then the email body. Nothing else.',
  ].join("\n");

  const user = [
    `Company name: ${company.companyName}`,
    `Website: ${company.website}`,
    `What they do: ${company.summary || "Not available."}`,
    company.jobTitles.length > 0
      ? `Open roles: ${company.jobTitles.join(", ")}`
      : "No specific open roles were listed.",
    "Write a short, polite follow-up email per the rules above.",
  ].join("\n");

  const raw = await chat(system, user, 300);
  return parseSubjectBody(raw, `Following up — ${company.companyName}`);
}

/** Drafts a short WhatsApp pitch, ≤50 words, no resume mention, no unfilled placeholders. */
export async function draftWhatsApp(company: CompanyContext): Promise<string> {
  const system = [
    "You write short WhatsApp outreach messages from a job seeker to a company, expressing interest in working there.",
    "Rules:",
    "- Never leave placeholders unfilled — use the real company name given.",
    "- Keep it under 50 words total.",
    "- Reference one concrete detail about the company.",
    "- Do not mention a resume or attachment — none is attached over WhatsApp.",
    "- Plain text only, no markdown, no subject line — just the message body, nothing else.",
  ].join("\n");

  const user = [
    `Company name: ${company.companyName}`,
    `What they do: ${company.summary || "Not available — keep it warm and general."}`,
    company.jobTitles.length > 0
      ? `Open roles: ${company.jobTitles.join(", ")}`
      : "No specific roles were found — express general interest.",
    "Write the WhatsApp message per the rules above.",
  ].join("\n");

  return chat(system, user, 150);
}
