import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(__dirname, "..", "..", "logs");

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function logFilePath(date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `run-${dateStr}.log`);
}

type Level = "info" | "warn" | "error";

function write(level: Level, message: string): void {
  ensureLogDir();
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  const consoleFn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  consoleFn(line);
  fs.appendFileSync(logFilePath(), line + "\n");
}

export const logger = {
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
};

/**
 * Appends a line to logs/{fileBaseName}-YYYY-MM-DD.log, separate from the
 * combined run log. Used for structured, single-purpose logs (fetch
 * failures/successes, send attempts) that need to stay easy to scan on
 * their own without console noise.
 */
export function writeLog(fileBaseName: string, message: string): void {
  ensureLogDir();
  const dateStr = new Date().toISOString().slice(0, 10);
  const filePath = path.join(LOG_DIR, `${fileBaseName}-${dateStr}.log`);
  const timestamp = new Date().toISOString();
  fs.appendFileSync(filePath, `[${timestamp}] ${message}\n`);
}
