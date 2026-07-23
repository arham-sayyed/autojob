import { logger, writeLog } from "./logger";

/**
 * Handles a fatal error from a pipeline stage: logs the full stack trace to
 * logs/errors-YYYY-MM-DD.log, prints a one-line human-readable summary, and
 * exits non-zero. Every Excel write (storage/excel.ts) is flushed to disk
 * immediately rather than buffered, so already-processed rows keep their
 * status and the row being processed when the error hit is simply left
 * unmarked — it gets retried on the next run.
 */
export function handleFatalError(stageName: string, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : message;

  writeLog("errors", `[${stageName}] ${stack}`);
  logger.error(`[${stageName}] fatal error: ${message}`);
  console.error(
    `\nStopped during "${stageName}": ${message}\n` +
      `See logs/errors-*.log for the full trace. Already-processed rows are saved — rerun to resume.`
  );

  return process.exit(1) as never;
}

/** Runs one pipeline stage, routing any thrown error through handleFatalError. */
export async function runStage(stageName: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    handleFatalError(stageName, err);
  }
}

/** Catches anything that slips past an individual stage wrapper (installed once at CLI startup). */
export function installGlobalHandlers(): void {
  process.on("uncaughtException", (err) => {
    handleFatalError("uncaughtException", err);
  });
  process.on("unhandledRejection", (reason) => {
    handleFatalError("unhandledRejection", reason);
  });
}
