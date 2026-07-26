import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

import { config } from "./config";
import { logger } from "./utils/logger";
import { runStage, installGlobalHandlers } from "./utils/gracefulExit";
import * as excel from "./storage/excel";
import type { CompanyRow, Status } from "./storage/excel";
import { backupExcel } from "./storage/backup";
import { discoverCompanies, closeBrowser as closeMapsBrowser } from "./scrapers/googleMaps";
import { crawlWebsite, fetchSinglePage, closeBrowser as closeWebsiteBrowser } from "./scrapers/website";
import { extractEmails, pickBestEmail, toStorageEmailSource } from "./extractors/email";
import { extractPhones, pickPrimaryPhones } from "./extractors/phone";
import { findCareersLink, detectATS, extractJobTitles, ATSName } from "./extractors/careers";
import { detectTechStack, techStackToString } from "./extractors/techStack";
import { summarize, scoreFit, draftEmail, draftFollowUp, draftWhatsApp, CompanyContext } from "./ai/groq";
import { sendEmail } from "./email/sender";
import { sendToRow as sendWhatsAppToRow, destroy as destroyWhatsAppClient } from "./whatsapp/sender";
import { computeReportStats } from "./report/stats";
import { buildReportHtml } from "./report/htmlReport";
import { generateReportPdf } from "./report/pdfReport";

installGlobalHandlers();

const RESUME_HIGHLIGHTS_PATH = path.resolve(__dirname, "..", "data", "resume-highlights.txt");

interface ParsedArgs {
  command: string;
  from?: number;
  to?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  let from: number | undefined;
  let to: number | undefined;
  let dryRun = false;
  for (const arg of rest) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--from=")) from = Number(arg.slice("--from=".length));
    else if (arg.startsWith("--to=")) to = Number(arg.slice("--to=".length));
  }
  return { command: command ?? "", from, to, dryRun };
}

function applyRange<T>(items: T[], from?: number, to?: number): T[] {
  return items.slice(from ?? 0, to ?? items.length);
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function readResumeHighlights(): string {
  if (fs.existsSync(RESUME_HIGHLIGHTS_PATH)) {
    const text = fs.readFileSync(RESUME_HIGHLIGHTS_PATH, "utf-8").trim();
    if (text && !text.startsWith("Replace this")) return text;
  }
  logger.warn(
    `[groq-draft] ${RESUME_HIGHLIGHTS_PATH} is missing or still the placeholder — using a generic fallback. ` +
      `Fill it in for better personalized emails.`
  );
  return "Software engineer with hands-on experience building full-stack web applications with Node.js, TypeScript, and React.";
}

function toCompanyContext(row: CompanyRow): CompanyContext {
  return {
    companyName: row.companyName || row.website,
    website: row.website,
    summary: row.summary,
    jobTitles: row.jobTitles
      ? row.jobTitles
          .split(";")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
  };
}

// ---------------------------------------------------------------------------
// discover — Maps search -> upsert new rows as Status=New (existing rows'
// status is left untouched: upsert only overwrites keys it's given).
// ---------------------------------------------------------------------------
async function cmdDiscover(args: ParsedArgs): Promise<void> {
  const results = await discoverCompanies();
  logger.info(`[discover] found ${results.length} raw listing(s) from Maps`);

  // Batched: upsert() re-reads and rewrites the whole workbook every call,
  // which is O(n²) I/O across ~130 companies in a typical run if done one
  // at a time — upsertMany() does it in a single read+write.
  const toUpsert: Array<Partial<CompanyRow> & { website: string }> = [];
  for (const result of results) {
    if (!result.website) continue; // nothing to scrape/email later
    if (args.dryRun) {
      console.log(
        `[dry-run] ${result.name} | ${result.website} | ${result.address ?? "-"} | rating=${result.rating ?? "-"}`
      );
    }
    toUpsert.push({
      website: result.website,
      companyName: result.name,
      address: result.address ?? "",
      googleRating: result.rating,
    });
  }
  await excel.upsertMany(toUpsert);
  logger.info(`[discover] upserted ${toUpsert.length} row(s)`);

  await closeMapsBrowser();
}

// ---------------------------------------------------------------------------
// scrape — for New rows: crawl the site, run every extractor, score fit,
// summarize, set Status=EmailFound/NoEmailFound.
// ---------------------------------------------------------------------------
async function cmdScrape(args: ParsedArgs): Promise<void> {
  const newRows = applyRange(await excel.getByStatus(["New"]), args.from, args.to);
  logger.info(`[scrape] processing ${newRows.length} row(s)`);

  for (const row of newRows) {
    try {
      const pages = await crawlWebsite(row.website);
      if (pages.length === 0) {
        logger.warn(`[scrape] no pages fetched for ${row.website}`);
        await excel.markStatus(row.website, "NoEmailFound", { dateScraped: new Date() });
        continue;
      }

      const emailCandidates = pages.flatMap((p) => extractEmails(p.html));
      const bestEmail = pickBestEmail(emailCandidates);

      const phoneCandidates = pages.flatMap((p) => extractPhones(p.html));
      const { mobile, landline } = pickPrimaryPhones(phoneCandidates);

      const homePage = pages.find((p) => new URL(p.url).pathname.replace(/\/$/, "") === "") ?? pages[0];

      let careersLink = findCareersLink(homePage.html, row.website);
      let ats: ATSName = "none";
      let jobTitles: string[] = [];

      if (careersLink) {
        ats = detectATS(careersLink);
        let careersHtml = pages.find((p) => p.url === careersLink)?.html;
        if (!careersHtml) {
          careersHtml = (await fetchSinglePage(careersLink)) ?? undefined;
        }
        if (careersHtml) {
          jobTitles = extractJobTitles(careersHtml, ats);
        }
      }

      const techStack = detectTechStack(pages.map((p) => p.html).join("\n"));
      const pageText = pages.map((p) => htmlToText(p.html)).join(" ");
      const fitScore = scoreFit({ jobTitles, ats, techStack, pageText });

      let summaryText = "";
      try {
        summaryText = await summarize(homePage.html);
      } catch (err) {
        logger.warn(
          `[scrape] summarize failed for ${row.website}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const status: Status = bestEmail ? "EmailFound" : "NoEmailFound";

      if (args.dryRun) {
        console.log(
          `[dry-run] ${row.website} -> email=${bestEmail?.email ?? "none"} (${bestEmail?.source ?? "-"}) ` +
            `mobile=${mobile ?? "-"} landline=${landline ?? "-"} ats=${ats} jobs=${jobTitles.length} ` +
            `tech=${techStack.join(",") || "-"} fit=${fitScore} status=${status}`
        );
      }

      await excel.upsert({
        website: row.website,
        email: bestEmail?.email ?? "",
        emailSource: bestEmail ? toStorageEmailSource(bestEmail.source) : "none",
        phoneMobile: mobile ?? "",
        phoneLandline: landline ?? "",
        careersUrl: careersLink ?? "",
        ats,
        jobTitles: jobTitles.join("; "),
        techStack: techStackToString(techStack),
        summary: summaryText,
        fitScore,
        status,
        dateScraped: new Date(),
      });
    } catch (err) {
      logger.error(
        `[scrape] failed for ${row.website}: ${err instanceof Error ? err.message : String(err)} — left as New for retry`
      );
    }
  }

  await closeWebsiteBrowser();
}

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------
async function cmdBackup(): Promise<void> {
  const dest = backupExcel();
  if (dest) logger.info(`[backup] saved ${dest}`);
}

// ---------------------------------------------------------------------------
// groq-draft — for EmailFound rows without a drafted email yet, generate and
// save email/follow-up/WhatsApp content (no sending).
// ---------------------------------------------------------------------------
async function cmdGroqDraft(args: ParsedArgs): Promise<void> {
  backupExcel();

  const rows = applyRange(await excel.getByStatus(["EmailFound"]), args.from, args.to);
  const toProcess = rows.filter((r) => !r.emailBody);
  logger.info(`[groq-draft] drafting for ${toProcess.length} row(s)`);

  const resumeHighlights = readResumeHighlights();

  for (const row of toProcess) {
    try {
      const context = toCompanyContext(row);
      const email = await draftEmail(context, resumeHighlights);
      const followUp = await draftFollowUp(context);
      const whatsapp = await draftWhatsApp(context);

      await excel.upsert({
        website: row.website,
        emailSubject: email.subject,
        emailBody: email.body,
        followUpSubject: followUp.subject,
        followUpBody: followUp.body,
        whatsAppMessage: whatsapp,
      });
    } catch (err) {
      logger.error(`[groq-draft] failed for ${row.website}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// send — for EmailFound rows with a drafted email, send (respects
// DAILY_SEND_CAP + AUTOPILOT), set Status=Emailed.
// ---------------------------------------------------------------------------
async function cmdSend(args: ParsedArgs): Promise<void> {
  const rows = applyRange(await excel.getByStatus(["EmailFound"]), args.from, args.to);
  const ready = rows.filter((r) => r.emailBody && r.email);
  logger.info(
    `[send] ${ready.length} row(s) ready (cap=${config.dailySendCap}, autopilot=${config.autopilot})`
  );

  for (const row of ready) {
    const result = await sendEmail({ to: row.email, subject: row.emailSubject, body: row.emailBody });
    if (!result.success) {
      if (result.stopBatch) {
        logger.warn(`[send] ${result.error} — stopping, remaining rows left for next run`);
        break;
      }
      logger.error(`[send] failed for ${row.website}: ${result.error} — left as EmailFound for retry`);
      continue;
    }
    await excel.markStatus(row.website, "Emailed", { dateEmailed: new Date() });
  }
}

// ---------------------------------------------------------------------------
// followup — for Emailed rows past FOLLOW_UP_AFTER_DAYS, send the drafted
// follow-up, set Status=FollowedUp.
// ---------------------------------------------------------------------------
async function cmdFollowup(args: ParsedArgs): Promise<void> {
  const rows = applyRange(await excel.getByStatus(["Emailed"]), args.from, args.to);
  const cutoffMs = Date.now() - config.followUpAfterDays * 24 * 60 * 60 * 1000;
  const due = rows.filter((r) => r.dateEmailed && r.dateEmailed.getTime() <= cutoffMs && r.followUpBody);
  logger.info(`[followup] ${due.length} row(s) due`);

  for (const row of due) {
    const result = await sendEmail({ to: row.email, subject: row.followUpSubject, body: row.followUpBody });
    if (!result.success) {
      if (result.stopBatch) {
        logger.warn(`[followup] ${result.error} — stopping, remaining rows left for next run`);
        break;
      }
      logger.error(`[followup] failed for ${row.website}: ${result.error} — left as Emailed for retry`);
      continue;
    }
    await excel.markStatus(row.website, "FollowedUp", { dateFollowedUp: new Date() });
  }
}

// ---------------------------------------------------------------------------
// whatsapp — standalone, --from/--to resumable. Skips landline/no-number
// rows without touching the client; getNumberId precheck before any send.
// ---------------------------------------------------------------------------
async function cmdWhatsapp(args: ParsedArgs): Promise<void> {
  backupExcel();

  const all = await excel.loadAll();
  const eligible = all.filter(
    (r) =>
      (r.status === "EmailFound" || r.status === "Emailed" || r.status === "FollowedUp") &&
      !r.whatsAppStatus &&
      (r.phoneMobile || r.phoneLandline) &&
      r.whatsAppMessage
  );
  const rows = applyRange(eligible, args.from, args.to);
  logger.info(
    `[whatsapp] ${rows.length} row(s) to process (cap=${config.dailyWhatsappCap}, autopilot=${config.autopilot})`
  );

  for (const row of rows) {
    const outcome = await sendWhatsAppToRow(
      { phoneMobile: row.phoneMobile, phoneLandline: row.phoneLandline },
      row.whatsAppMessage
    );

    if (outcome.status === null) {
      if (outcome.stopBatch) {
        logger.warn(`[whatsapp] stopping: ${outcome.error}`);
        break;
      }
      if (outcome.error) {
        logger.warn(`[whatsapp] skipping ${row.website} after error, will retry next run: ${outcome.error}`);
      }
      continue; // dry-run, or a per-row error — left unmarked for review/retry
    }

    await excel.markStatus(row.website, row.status, {
      whatsAppStatus: outcome.status,
      dateWhatsApped: outcome.status === "Sent" ? new Date() : null,
    });
  }

  await destroyWhatsAppClient();
  backupExcel();
}

// ---------------------------------------------------------------------------
// report — generate a PDF summary (stats, pipeline funnel, top matches) into
// reports/, named with a date+time suffix so repeated same-day runs never
// collide.
// ---------------------------------------------------------------------------
async function cmdReport(): Promise<void> {
  const rows = await excel.loadAll();
  const stats = computeReportStats(rows);
  const generatedAt = new Date();
  const html = buildReportHtml(stats, generatedAt);

  const timestamp = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const outPath = path.resolve(__dirname, "..", "reports", `report-${timestamp}.pdf`);
  await generateReportPdf(html, outPath);

  logger.info(`[report] saved ${outPath}`);
}

// ---------------------------------------------------------------------------
// run-all
// ---------------------------------------------------------------------------
async function cmdRunAll(args: ParsedArgs): Promise<void> {
  await runStage("discover", () => cmdDiscover({ ...args, dryRun: false }));
  await runStage("scrape", () => cmdScrape({ ...args, dryRun: false }));
  await runStage("backup", cmdBackup);
  await runStage("groq-draft", () => cmdGroqDraft(args));
  await runStage("send", () => cmdSend(args));
  await runStage("whatsapp", () => cmdWhatsapp(args));
  await runStage("followup", () => cmdFollowup(args));
  await runStage("backup-final", cmdBackup);
  await runStage("report", cmdReport);
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------
function printUsage(): void {
  console.log(`Usage: ts-node src/index.ts <command> [--from=N] [--to=N] [--dry-run]

Commands:
  discover     Search Google Maps and upsert new companies (Status=New)
  scrape       Crawl + extract email/phone/careers/tech-stack for New rows
  backup       Save a timestamped copy of companies.xlsx to data/backups/
  groq-draft   Draft email/follow-up/WhatsApp content for EmailFound rows
  send         Send drafted emails (respects DAILY_SEND_CAP, AUTOPILOT)
  followup     Send follow-up emails for Emailed rows past FOLLOW_UP_AFTER_DAYS
  whatsapp     Send drafted WhatsApp messages (respects DAILY_WHATSAPP_CAP, AUTOPILOT)
  run-all      discover -> scrape -> backup -> groq-draft -> send -> whatsapp -> followup -> backup -> report
  report       Generate a PDF summary report (stats, pipeline funnel, top FitScores) into reports/

--from/--to are 0-based row indices into the sheet (--to exclusive); default to the full sheet.
--dry-run (discover/scrape only) logs extracted data to the console without changing Status.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "discover":
      await runStage("discover", () => cmdDiscover(args));
      break;
    case "scrape":
      await runStage("scrape", () => cmdScrape(args));
      break;
    case "backup":
      await runStage("backup", cmdBackup);
      break;
    case "groq-draft":
      await runStage("groq-draft", () => cmdGroqDraft(args));
      break;
    case "send":
      await runStage("send", () => cmdSend(args));
      break;
    case "followup":
      await runStage("followup", () => cmdFollowup(args));
      break;
    case "whatsapp":
      await runStage("whatsapp", () => cmdWhatsapp(args));
      break;
    case "run-all":
      await cmdRunAll(args);
      break;
    case "report":
      await runStage("report", cmdReport);
      break;
    default:
      printUsage();
      process.exitCode = args.command ? 1 : 0;
  }
}

main();
