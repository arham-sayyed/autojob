import type { ReportStats } from "./stats";
import type { CompanyRow } from "../storage/excel";

const PIPELINE_ORDER = [
  "New",
  "EmailFound",
  "NoEmailFound",
  "Emailed",
  "FollowedUp",
  "Replied",
  "Rejected",
  "DoNotContact",
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statCount(stats: ReportStats, status: string): number {
  return stats.byStatus.find((s) => s.status === status)?.count ?? 0;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function renderStatTiles(stats: ReportStats): string {
  const tiles = [
    { label: "Total Companies", value: stats.totalCompanies },
    { label: "Emails Found", value: statCount(stats, "EmailFound") },
    { label: "Sent", value: statCount(stats, "Emailed") },
  ];
  return tiles
    .map(
      (t) => `<div class="tile"><div class="tile-value">${t.value}</div><div class="tile-label">${escapeHtml(
        t.label
      )}</div></div>`
    )
    .join("\n");
}

function renderFunnel(stats: ReportStats): string {
  const byStatus = new Map(stats.byStatus.map((s) => [s.status, s.count]));
  const ordered = PIPELINE_ORDER.map((status) => ({ status, count: byStatus.get(status) ?? 0 })).filter(
    (s) => s.count > 0
  );
  if (ordered.length === 0) return "<p>No companies tracked yet.</p>";

  const maxCount = Math.max(...ordered.map((s) => s.count));
  return ordered
    .map((s) => {
      const widthPct = Math.max(4, Math.round((s.count / maxCount) * 100));
      return `<div class="funnel-row">
        <div class="funnel-label">${escapeHtml(s.status)}</div>
        <div class="funnel-bar-track"><div class="funnel-bar" style="width:${widthPct}%"></div></div>
        <div class="funnel-count">${s.count}</div>
      </div>`;
    })
    .join("\n");
}

function renderWhatsApp(stats: ReportStats): string {
  if (stats.byWhatsApp.length === 0) return "";
  const items = stats.byWhatsApp
    .map((s) => `<span class="wa-item"><strong>${s.count}</strong> ${escapeHtml(s.status)}</span>`)
    .join(" &nbsp;·&nbsp; ");
  return `<div class="section"><h2>WhatsApp Status</h2><p>${items}</p></div>`;
}

function renderTopFit(topFit: CompanyRow[]): string {
  if (topFit.length === 0) {
    return `<div class="section"><h2>Top Matches</h2><p>No scored companies yet.</p></div>`;
  }
  const rows = topFit
    .map(
      (r) => `<tr>
        <td>${r.fitScore ?? "-"}</td>
        <td>${escapeHtml(r.companyName || r.website)}</td>
        <td>${escapeHtml(r.website)}</td>
        <td>${escapeHtml(r.status)}</td>
      </tr>`
    )
    .join("\n");
  return `<div class="section">
    <h2>Top Matches</h2>
    <table>
      <thead><tr><th>Fit</th><th>Company</th><th>Website</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderRoles(stats: ReportStats): string {
  if (stats.distinctRoles.length === 0) return "";
  const preview = stats.distinctRoles.slice(0, 20).join(", ");
  const suffix = stats.distinctRoles.length > 20 ? ", ..." : "";
  return `<p class="muted">${stats.distinctRoles.length} distinct role(s) seen: ${escapeHtml(
    preview
  )}${suffix}</p>`;
}

export function buildReportHtml(stats: ReportStats, generatedAt: Date): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>AutoJob Outreach Report</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a2e;
    margin: 0;
    padding: 32px;
    background: #ffffff;
  }
  header { border-bottom: 2px solid #eee; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .timestamp { color: #666; font-size: 13px; }
  .tiles { display: flex; gap: 16px; margin-bottom: 28px; }
  .tile { border: 1px solid #e2e2e2; border-radius: 8px; padding: 16px 20px; flex: 1; text-align: center; }
  .tile-value { font-size: 28px; font-weight: 700; color: #4361ee; }
  .tile-label { font-size: 12px; color: #666; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  .section { margin-bottom: 28px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.04em; color: #444; margin-bottom: 12px; }
  .funnel-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
  .funnel-label { width: 110px; flex-shrink: 0; }
  .funnel-bar-track { flex: 1; background: #f2f2f2; border-radius: 4px; height: 16px; }
  .funnel-bar { background: #4361ee; height: 100%; border-radius: 4px; }
  .funnel-count { width: 36px; text-align: right; flex-shrink: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; }
  th { color: #666; font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .muted { color: #888; font-size: 12px; }
  .wa-item { font-size: 13px; }
</style>
</head>
<body>
  <header>
    <h1>AutoJob Outreach Report</h1>
    <div class="timestamp">Generated ${formatTimestamp(generatedAt)}</div>
  </header>

  <div class="tiles">
    ${renderStatTiles(stats)}
  </div>

  <div class="section">
    <h2>Pipeline</h2>
    ${renderFunnel(stats)}
    ${renderRoles(stats)}
  </div>

  ${renderWhatsApp(stats)}

  ${renderTopFit(stats.topFit)}
</body>
</html>`;
}
