import nodemailer, { Transporter } from "nodemailer";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger, writeLog } from "../utils/logger";
import { createRateLimiter } from "../utils/rateLimiter";
import { isValidEmail } from "../extractors/email";

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
  // true only when the *whole batch* should stop (daily cap reached).
  // A per-row failure (bad address, transport error) leaves this unset, so
  // callers skip just that row and continue with the rest.
  stopBatch?: boolean;
}

const DEFAULT_SENT_COUNT_DIR = path.resolve(__dirname, "..", "..", "logs");

export interface EmailSender {
  sendEmail(params: SendEmailParams): Promise<SendResult>;
  hasReachedDailyCap(): boolean;
}

export function createEmailSender(options?: {
  sentCountDir?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
}): EmailSender {
  const sentCountDir = options?.sentCountDir ?? DEFAULT_SENT_COUNT_DIR;

  // 2-5 min randomized delay between sends — same reasoning as the WhatsApp
  // sender: protects sending reputation, avoids looking like a bulk blast.
  const sendLimiter = createRateLimiter({
    minDelayMs: options?.minDelayMs ?? 2 * 60 * 1000,
    maxDelayMs: options?.maxDelayMs ?? 5 * 60 * 1000,
  });

  let transporter: Transporter | null = null;
  function getTransporter(): Transporter {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
        auth: { user: config.smtpUser, pass: config.smtpPass },
      });
    }
    return transporter;
  }

  function sentCountFilePath(date = new Date()): string {
    const dateStr = date.toISOString().slice(0, 10);
    return path.join(sentCountDir, `sent-count-${dateStr}.json`);
  }

  function readSentCount(): number {
    const filePath = sentCountFilePath();
    if (!fs.existsSync(filePath)) return 0;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return typeof data.count === "number" ? data.count : 0;
    } catch {
      return 0;
    }
  }

  function incrementSentCount(): void {
    const filePath = sentCountFilePath();
    if (!fs.existsSync(sentCountDir)) {
      fs.mkdirSync(sentCountDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify({ count: readSentCount() + 1 }, null, 2));
  }

  function hasReachedDailyCap(): boolean {
    return readSentCount() >= config.dailySendCap;
  }

  function logSendAttempt(to: string, subject: string, success: boolean, error?: string): void {
    const line = `to=${to} subject="${subject}" success=${success}${error ? ` error="${error}"` : ""}`;
    writeLog("email-sends", line);
    if (success) {
      logger.info(`[email] sent to ${to}: ${subject}`);
    } else {
      logger.error(`[email] failed to send to ${to}: ${error}`);
    }
  }

  async function sendRaw(to: string, subject: string, body: string): Promise<SendResult> {
    try {
      const hasResume = fs.existsSync(config.resumePath);
      await getTransporter().sendMail({
        from: config.smtpUser,
        to,
        subject,
        text: body,
        attachments: hasResume ? [{ path: config.resumePath }] : [],
      });
      if (!hasResume) {
        logger.warn(`[email] RESUME_PATH not found at ${config.resumePath} — sent without attachment`);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Sends an outreach email, enforcing DAILY_SEND_CAP and AUTOPILOT.
   * When AUTOPILOT is false, the send is redirected to SMTP_USER (yourself)
   * so real generated content can be reviewed before anything reaches a
   * real company — the requested `to` is still what gets logged.
   */
  async function sendEmail(params: SendEmailParams): Promise<SendResult> {
    // Last checkpoint before an irreversible external send — don't rely
    // solely on upstream extraction validation to keep garbage out.
    if (!isValidEmail(params.to)) {
      const msg = `refusing to send: "${params.to}" is not a well-formed email address`;
      logSendAttempt(params.to, params.subject, false, msg);
      return { success: false, error: msg };
    }

    return sendLimiter.run(async () => {
      if (hasReachedDailyCap()) {
        const msg = `daily send cap (${config.dailySendCap}) reached`;
        logSendAttempt(params.to, params.subject, false, msg);
        return { success: false, error: msg, stopBatch: true };
      }

      const actualTo = config.autopilot ? params.to : config.smtpUser;
      const result = await sendRaw(actualTo, params.subject, params.body);
      logSendAttempt(params.to, params.subject, result.success, result.error);
      if (result.success) {
        incrementSentCount();
      }
      return result;
    });
  }

  return { sendEmail, hasReachedDailyCap };
}

const defaultSender = createEmailSender();
export const sendEmail = defaultSender.sendEmail;
export const hasReachedDailyCap = defaultSender.hasReachedDailyCap;
