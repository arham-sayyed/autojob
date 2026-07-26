import { describe, it, expect } from "vitest";
import { computeReportStats } from "../src/report/stats";
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
  });
});
