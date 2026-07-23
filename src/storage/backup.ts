import fs from "fs";
import path from "path";
import { companiesStore } from "./excel";
import { logger } from "../utils/logger";

const DEFAULT_BACKUP_DIR = path.resolve(__dirname, "..", "..", "data", "backups");

/**
 * Saves a timestamped copy of the companies workbook to data/backups/.
 * Returns the backup path, or null if there was nothing to back up yet.
 */
export function backupExcel(
  sourcePath: string = companiesStore.filePath,
  destDir: string = DEFAULT_BACKUP_DIR
): string | null {
  if (!fs.existsSync(sourcePath)) {
    logger.warn(`[backup] no file to back up at ${sourcePath}`);
    return null;
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const destPath = path.join(destDir, `${baseName}-${timestamp}${path.extname(sourcePath)}`);

  fs.copyFileSync(sourcePath, destPath);
  logger.info(`[backup] saved ${destPath}`);
  return destPath;
}
