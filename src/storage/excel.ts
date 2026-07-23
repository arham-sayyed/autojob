import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

export type Status =
  | "New"
  | "EmailFound"
  | "NoEmailFound"
  | "Emailed"
  | "FollowedUp"
  | "Replied"
  | "Rejected"
  | "DoNotContact";

export type EmailSource = "mailto" | "footer" | "regex" | "jsonld" | "obfuscated" | "none" | "";

export type WhatsAppStatus =
  | ""
  | "Sent"
  | "Skipped-Landline"
  | "Skipped-NoNumber"
  | "Failed-NotOnWhatsApp";

export interface CompanyRow {
  companyName: string;
  website: string;
  address: string;
  googleRating: number | null;
  email: string;
  emailSource: EmailSource;
  phoneMobile: string;
  phoneLandline: string;
  careersUrl: string;
  ats: string;
  jobTitles: string;
  techStack: string;
  summary: string;
  fitScore: number | null;
  status: Status;
  whatsAppStatus: WhatsAppStatus;
  dateScraped: Date | null;
  dateEmailed: Date | null;
  dateWhatsApped: Date | null;
  dateFollowedUp: Date | null;
  notes: string;
  // Drafted outreach content (populated by the groq-draft stage, consumed by send/whatsapp).
  emailSubject: string;
  emailBody: string;
  whatsAppMessage: string;
  followUpSubject: string;
  followUpBody: string;
}

const SHEET_NAME = "Companies";

interface ColumnDef {
  header: string;
  key: keyof CompanyRow;
  width?: number;
}

const COLUMNS: ColumnDef[] = [
  { header: "CompanyName", key: "companyName", width: 28 },
  { header: "Website", key: "website", width: 28 },
  { header: "Address", key: "address", width: 32 },
  { header: "GoogleRating", key: "googleRating", width: 12 },
  { header: "Email", key: "email", width: 28 },
  { header: "EmailSource", key: "emailSource", width: 14 },
  { header: "PhoneMobile", key: "phoneMobile", width: 14 },
  { header: "PhoneLandline", key: "phoneLandline", width: 14 },
  { header: "CareersURL", key: "careersUrl", width: 30 },
  { header: "ATS", key: "ats", width: 12 },
  { header: "JobTitles", key: "jobTitles", width: 40 },
  { header: "TechStack", key: "techStack", width: 24 },
  { header: "Summary", key: "summary", width: 40 },
  { header: "FitScore", key: "fitScore", width: 10 },
  { header: "Status", key: "status", width: 16 },
  { header: "WhatsAppStatus", key: "whatsAppStatus", width: 22 },
  { header: "DateScraped", key: "dateScraped", width: 14 },
  { header: "DateEmailed", key: "dateEmailed", width: 14 },
  { header: "DateWhatsApped", key: "dateWhatsApped", width: 14 },
  { header: "DateFollowedUp", key: "dateFollowedUp", width: 14 },
  { header: "Notes", key: "notes", width: 30 },
  { header: "EmailSubject", key: "emailSubject", width: 30 },
  { header: "EmailBody", key: "emailBody", width: 50 },
  { header: "WhatsAppMessage", key: "whatsAppMessage", width: 40 },
  { header: "FollowUpSubject", key: "followUpSubject", width: 30 },
  { header: "FollowUpBody", key: "followUpBody", width: 50 },
];

const WHATSAPP_STATUS_COLORS: Partial<Record<WhatsAppStatus, string>> = {
  Sent: "FFC6EFCE", // green
  "Skipped-Landline": "FFD9D9D9", // grey
  "Skipped-NoNumber": "FFD9D9D9", // grey
  "Failed-NotOnWhatsApp": "FFFFC7CE", // red
};

export function normalizeWebsite(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

function emptyRow(website: string): CompanyRow {
  return {
    companyName: "",
    website,
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
  };
}

function toStr(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "text" in (v as { text?: unknown })) {
    return String((v as { text?: unknown }).text ?? "");
  }
  return String(v);
}

function toNum(v: ExcelJS.CellValue): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? null : n;
}

function toDate(v: ExcelJS.CellValue): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function getCellValue(row: ExcelJS.Row, key: keyof CompanyRow): ExcelJS.CellValue {
  return row.getCell(key).value;
}

function rowToCompany(row: ExcelJS.Row): CompanyRow {
  return {
    companyName: toStr(getCellValue(row, "companyName")),
    website: toStr(getCellValue(row, "website")),
    address: toStr(getCellValue(row, "address")),
    googleRating: toNum(getCellValue(row, "googleRating")),
    email: toStr(getCellValue(row, "email")),
    emailSource: toStr(getCellValue(row, "emailSource")) as EmailSource,
    phoneMobile: toStr(getCellValue(row, "phoneMobile")),
    phoneLandline: toStr(getCellValue(row, "phoneLandline")),
    careersUrl: toStr(getCellValue(row, "careersUrl")),
    ats: toStr(getCellValue(row, "ats")),
    jobTitles: toStr(getCellValue(row, "jobTitles")),
    techStack: toStr(getCellValue(row, "techStack")),
    summary: toStr(getCellValue(row, "summary")),
    fitScore: toNum(getCellValue(row, "fitScore")),
    status: (toStr(getCellValue(row, "status")) || "New") as Status,
    whatsAppStatus: toStr(getCellValue(row, "whatsAppStatus")) as WhatsAppStatus,
    dateScraped: toDate(getCellValue(row, "dateScraped")),
    dateEmailed: toDate(getCellValue(row, "dateEmailed")),
    dateWhatsApped: toDate(getCellValue(row, "dateWhatsApped")),
    dateFollowedUp: toDate(getCellValue(row, "dateFollowedUp")),
    notes: toStr(getCellValue(row, "notes")),
    emailSubject: toStr(getCellValue(row, "emailSubject")),
    emailBody: toStr(getCellValue(row, "emailBody")),
    whatsAppMessage: toStr(getCellValue(row, "whatsAppMessage")),
    followUpSubject: toStr(getCellValue(row, "followUpSubject")),
    followUpBody: toStr(getCellValue(row, "followUpBody")),
  };
}

function writeCompanyToRow(row: ExcelJS.Row, company: CompanyRow): void {
  for (const col of COLUMNS) {
    const value = company[col.key];
    const cell = row.getCell(col.key);
    if (value instanceof Date) {
      cell.value = value;
      cell.numFmt = "yyyy-mm-dd";
    } else {
      cell.value = (value === undefined ? null : value) as ExcelJS.CellValue;
    }
  }

  const whatsAppCell = row.getCell("whatsAppStatus");
  const fillColor = WHATSAPP_STATUS_COLORS[company.whatsAppStatus];
  if (fillColor) {
    whatsAppCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: fillColor },
    };
  } else {
    whatsAppCell.fill = { type: "pattern", pattern: "none" };
  }
}

export interface ExcelStore {
  filePath: string;
  loadAll(): Promise<CompanyRow[]>;
  getByStatus(statuses: Status[]): Promise<CompanyRow[]>;
  upsert(row: Partial<CompanyRow> & { website: string }): Promise<void>;
  markStatus(
    website: string,
    status: Status,
    extraFields?: Partial<CompanyRow>
  ): Promise<void>;
}

export function createExcelStore(filePath: string): ExcelStore {
  function ensureDir(): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async function loadWorkbook(): Promise<{ workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet }> {
    ensureDir();
    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(filePath)) {
      await workbook.xlsx.readFile(filePath);
    }
    let sheet = workbook.getWorksheet(SHEET_NAME);
    if (!sheet) {
      sheet = workbook.addWorksheet(SHEET_NAME);
    }
    // Column `key` mapping is runtime-only metadata (not persisted in the .xlsx
    // file), so it must be re-applied every time the workbook is loaded/created.
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    return { workbook, sheet };
  }

  async function saveWorkbook(workbook: ExcelJS.Workbook): Promise<void> {
    ensureDir();
    await workbook.xlsx.writeFile(filePath);
  }

  function findRow(sheet: ExcelJS.Worksheet, normalizedWebsite: string): ExcelJS.Row | undefined {
    let found: ExcelJS.Row | undefined;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const website = toStr(row.getCell("website").value);
      if (website && normalizeWebsite(website) === normalizedWebsite) {
        found = row;
      }
    });
    return found;
  }

  async function loadAll(): Promise<CompanyRow[]> {
    const { sheet } = await loadWorkbook();
    const rows: CompanyRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const company = rowToCompany(row);
      if (!company.website) return;
      rows.push(company);
    });
    return rows;
  }

  async function getByStatus(statuses: Status[]): Promise<CompanyRow[]> {
    const all = await loadAll();
    const wanted = new Set(statuses);
    return all.filter((r) => wanted.has(r.status));
  }

  async function upsert(row: Partial<CompanyRow> & { website: string }): Promise<void> {
    const { workbook, sheet } = await loadWorkbook();
    const normalized = normalizeWebsite(row.website);
    const existing = findRow(sheet, normalized);

    const base = existing ? rowToCompany(existing) : emptyRow(normalized);
    const merged: CompanyRow = { ...base, ...row, website: normalized };

    const targetRow = existing ?? sheet.addRow({});
    writeCompanyToRow(targetRow, merged);
    targetRow.commit();
    await saveWorkbook(workbook);
  }

  async function markStatus(
    website: string,
    status: Status,
    extraFields?: Partial<CompanyRow>
  ): Promise<void> {
    const { workbook, sheet } = await loadWorkbook();
    const normalized = normalizeWebsite(website);
    const existing = findRow(sheet, normalized);
    if (!existing) {
      throw new Error(`markStatus: no row found for website "${website}"`);
    }
    const merged: CompanyRow = {
      ...rowToCompany(existing),
      ...extraFields,
      status,
      website: normalized,
    };
    writeCompanyToRow(existing, merged);
    existing.commit();
    await saveWorkbook(workbook);
  }

  return { filePath, loadAll, getByStatus, upsert, markStatus };
}

const DEFAULT_EXCEL_PATH = path.resolve(__dirname, "..", "..", "data", "companies.xlsx");

export const companiesStore = createExcelStore(DEFAULT_EXCEL_PATH);

export const loadAll = companiesStore.loadAll;
export const getByStatus = companiesStore.getByStatus;
export const upsert = companiesStore.upsert;
export const markStatus = companiesStore.markStatus;
