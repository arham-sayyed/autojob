import type { CompanyRow } from "../storage/excel";

export interface StatusCount {
  status: string;
  count: number;
}

export interface ReportStats {
  totalCompanies: number;
  byStatus: StatusCount[];
  byWhatsApp: StatusCount[];
  distinctRoles: string[];
  topFit: CompanyRow[];
  emailsFoundCount: number;
  sentCount: number;
}

function countBy(counts: Record<string, number>): StatusCount[] {
  return Object.entries(counts)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeReportStats(rows: CompanyRow[]): ReportStats {
  const statusCounts: Record<string, number> = {};
  const whatsAppCounts: Record<string, number> = {};
  const roles = new Set<string>();

  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    const wa = row.whatsAppStatus || "(none)";
    whatsAppCounts[wa] = (whatsAppCounts[wa] ?? 0) + 1;
    if (row.jobTitles) {
      row.jobTitles
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((t) => roles.add(t));
    }
  }

  const topFit = [...rows]
    .filter((r) => r.fitScore !== null)
    .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
    .slice(0, 10);

  return {
    totalCompanies: rows.length,
    byStatus: countBy(statusCounts),
    byWhatsApp: countBy(whatsAppCounts),
    distinctRoles: [...roles].sort(),
    topFit,
    emailsFoundCount: rows.filter((r) => r.email !== "").length,
    sentCount: rows.filter((r) => r.dateEmailed !== null).length,
  };
}
