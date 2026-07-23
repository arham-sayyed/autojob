import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface Config {
  groqApiKey: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  resumePath: string;
  dailySendCap: number;
  dailyWhatsappCap: number;
  followUpAfterDays: number;
  searchCities: string[];
  searchTerms: string[];
  autopilot: boolean;
  testWhatsappNumber: string | null;
}

const REQUIRED_VARS = [
  "GROQ_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "RESUME_PATH",
  "DAILY_SEND_CAP",
  "DAILY_WHATSAPP_CAP",
  "FOLLOW_UP_AFTER_DAYS",
  "SEARCH_CITIES",
  "SEARCH_TERMS",
] as const;

function loadConfig(): Config {
  const missing = REQUIRED_VARS.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === ""
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill these in.`
    );
  }

  const numericVars: Record<string, number> = {
    DAILY_SEND_CAP: Number(process.env.DAILY_SEND_CAP),
    DAILY_WHATSAPP_CAP: Number(process.env.DAILY_WHATSAPP_CAP),
    FOLLOW_UP_AFTER_DAYS: Number(process.env.FOLLOW_UP_AFTER_DAYS),
    SMTP_PORT: Number(process.env.SMTP_PORT),
  };
  const invalidNumeric = Object.entries(numericVars)
    .filter(([, value]) => Number.isNaN(value))
    .map(([key]) => key);
  if (invalidNumeric.length > 0) {
    throw new Error(
      `Environment variable(s) must be valid numbers: ${invalidNumeric.join(", ")}`
    );
  }

  return {
    groqApiKey: process.env.GROQ_API_KEY!,
    smtpHost: process.env.SMTP_HOST!,
    smtpPort: numericVars.SMTP_PORT,
    smtpUser: process.env.SMTP_USER!,
    smtpPass: process.env.SMTP_PASS!,
    resumePath: path.resolve(process.env.RESUME_PATH!),
    dailySendCap: numericVars.DAILY_SEND_CAP,
    dailyWhatsappCap: numericVars.DAILY_WHATSAPP_CAP,
    followUpAfterDays: numericVars.FOLLOW_UP_AFTER_DAYS,
    searchCities: process.env
      .SEARCH_CITIES!.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    searchTerms: process.env
      .SEARCH_TERMS!.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    autopilot: (process.env.AUTOPILOT ?? "false").trim().toLowerCase() === "true",
    testWhatsappNumber: process.env.TEST_WHATSAPP_NUMBER?.trim() || null,
  };
}

export const config = loadConfig();
