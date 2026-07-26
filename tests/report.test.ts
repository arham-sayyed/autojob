import { describe, it, expect } from "vitest";
import { computeReportStats } from "../src/report/stats";
import { buildReportHtml } from "../src/report/htmlReport";
import type { CompanyRow } from "../src/storage/excel";

function row(overrides: Partial<CompanyRow>): CompanyRow {
  return {
    companyName: "",
    website: "example.com",
    address: "",
    googleRating: null,
    email: "",
    emailSource: "",
    phoneMobile: "",
    phoneLandline: "",
    careersUrl: "",
    ats: "",
    jobTitles: "",
    techStack: "",
    summary: "",
    fitScore: null,
    status: "New",
    whatsAppStatus: "",
    dateScraped: null,
    dateEmailed: null,
    dateWhatsApped: null,
    dateFollowedUp: null,
    notes: "",
    emailSubject: "",
    emailBody: "",
    whatsAppMessage: "",
    followUpSubject: "",
    followUpBody: "",
    ...overrides,
  };
}

describe("report/stats", () => {
  it("counts rows by status, sorted descending by count", () => {
    const rows = [
      row({ status: "New" }),
      row({ status: "New" }),
      row({ status: "Emailed" }),
    ];
    const stats = computeReportStats(rows);
    expect(stats.totalCompanies).toBe(3);
    expect(stats.byStatus).toEqual([
      { status: "New", count: 2 },
      { status: "Emailed", count: 1 },
    ]);
  });

  it("counts rows by WhatsApp status, using '(none)' for empty string", () => {
    const rows = [
      row({ whatsAppStatus: "Sent" }),
      row({ whatsAppStatus: "" }),
      row({ whatsAppStatus: "" }),
    ];
    const stats = computeReportStats(rows);
    expect(stats.byWhatsApp).toEqual([
      { status: "(none)", count: 2 },
      { status: "Sent", count: 1 },
    ]);
  });

  it("collects distinct, trimmed, sorted job titles across semicolon-separated lists", () => {
    const rows = [
      row({ jobTitles: "Backend Engineer; Frontend Engineer" }),
      row({ jobTitles: "Backend Engineer;  QA Engineer " }),
      row({ jobTitles: "" }),
    ];
    const stats = computeReportStats(rows);
    expect(stats.distinctRoles).toEqual(["Backend Engineer", "Frontend Engineer", "QA Engineer"]);
  });

  it("returns the top 10 rows by fitScore descending, ignoring null scores", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => row({ website: `site${i}.com`, fitScore: i })),
      row({ website: "unscored.com", fitScore: null }),
    ];
    const stats = computeReportStats(rows);
    expect(stats.topFit).toHaveLength(10);
    expect(stats.topFit[0].fitScore).toBe(11);
    expect(stats.topFit[0].website).toBe("site11.com");
    expect(stats.topFit[9].fitScore).toBe(2);
  });

  it("returns fewer than 10 topFit rows when fewer than 10 are scored", () => {
    const rows = [row({ website: "a.com", fitScore: 5 }), row({ website: "b.com", fitScore: 9 })];
    const stats = computeReportStats(rows);
    expect(stats.topFit.map((r) => r.website)).toEqual(["b.com", "a.com"]);
  });

  it("handles an empty rows array", () => {
    const stats = computeReportStats([]);
    expect(stats.totalCompanies).toBe(0);
    expect(stats.byStatus).toEqual([]);
    expect(stats.byWhatsApp).toEqual([]);
    expect(stats.distinctRoles).toEqual([]);
    expect(stats.topFit).toEqual([]);
    expect(stats.emailsFoundCount).toBe(0);
    expect(stats.sentCount).toBe(0);
  });

  it("counts emailsFoundCount and sentCount cumulatively, not by current status", () => {
    const rows = [
      // Progressed all the way to FollowedUp — status is no longer EmailFound/Emailed,
      // but an email was found and sent, so it should still count in both tiles.
      row({ status: "FollowedUp", email: "a@example.com", dateEmailed: new Date("2026-01-01") }),
      // Currently sitting at EmailFound, no email sent yet.
      row({ status: "EmailFound", email: "b@example.com", dateEmailed: null }),
      // No email ever found.
      row({ status: "New", email: "", dateEmailed: null }),
    ];
    const stats = computeReportStats(rows);
    expect(stats.emailsFoundCount).toBe(2);
    expect(stats.sentCount).toBe(1);
  });
});

describe("report/htmlReport", () => {
  it("includes total count, stat tiles, and generated timestamp", () => {
    const stats = computeReportStats([
      row({ status: "New" }),
      row({ status: "EmailFound" }),
      row({ status: "Emailed" }),
    ]);
    // Local-timezone constructor (not a UTC ISO string) so the expected output
    // matches formatTimestamp's local-time rendering regardless of the test
    // runner's timezone.
    const html = buildReportHtml(stats, new Date(2026, 6, 26, 14, 32));
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("AutoJob Outreach Report");
    expect(html).toContain("2026-07-26 14:32");
    expect(html).toContain(">3<"); // total companies tile
  });

  it("renders a funnel bar for every non-zero status in pipeline order", () => {
    const stats = computeReportStats([
      row({ status: "Emailed" }),
      row({ status: "New" }),
      row({ status: "New" }),
    ]);
    const html = buildReportHtml(stats, new Date());
    const newIndex = html.indexOf("New");
    const emailedIndex = html.indexOf("Emailed");
    expect(newIndex).toBeGreaterThan(-1);
    expect(emailedIndex).toBeGreaterThan(-1);
    expect(newIndex).toBeLessThan(emailedIndex); // pipeline order: New before Emailed
  });

  it("omits statuses with zero rows from the funnel", () => {
    const stats = computeReportStats([row({ status: "New" })]);
    const html = buildReportHtml(stats, new Date());
    expect(html).not.toContain("Replied");
  });

  it("renders the top fit table with company name, website, and score", () => {
    const stats = computeReportStats([
      row({ website: "acme.com", companyName: "Acme Robotics", fitScore: 92 }),
    ]);
    const html = buildReportHtml(stats, new Date());
    expect(html).toContain("Acme Robotics");
    expect(html).toContain("acme.com");
    expect(html).toContain("92");
  });

  it("falls back to website when companyName is blank in the top fit table", () => {
    const stats = computeReportStats([row({ website: "noname.com", fitScore: 50 })]);
    const html = buildReportHtml(stats, new Date());
    expect(html).toContain("noname.com");
  });

  it("shows a placeholder message when there are no scored companies", () => {
    const stats = computeReportStats([row({ status: "New", fitScore: null })]);
    const html = buildReportHtml(stats, new Date());
    expect(html).toContain("No scored companies yet");
  });

  it("shows WhatsApp status counts", () => {
    const stats = computeReportStats([row({ whatsAppStatus: "Sent" })]);
    const html = buildReportHtml(stats, new Date());
    expect(html).toContain("WhatsApp Status");
    expect(html).toContain("<strong>1</strong> Sent");
  });
});
