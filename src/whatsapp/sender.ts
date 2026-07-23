import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger, writeLog } from "../utils/logger";
import { createRateLimiter } from "../utils/rateLimiter";
import type { WhatsAppStatus } from "../storage/excel";

export interface WhatsAppRow {
  phoneMobile: string;
  phoneLandline: string;
}

export interface WhatsAppOutcome {
  // null means "leave the row's WhatsAppStatus untouched" — used for the
  // daily cap, dry-run reviews, and unexpected send errors, all of which
  // should be retried on a later run rather than permanently marked.
  status: WhatsAppStatus | null;
  error?: string;
}

const DEFAULT_COUNT_DIR = path.resolve(__dirname, "..", "..", "logs");

export interface WhatsAppSenderOptions {
  countDir?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface WhatsAppSender {
  sendToRow(row: WhatsAppRow, message: string): Promise<WhatsAppOutcome>;
  hasReachedDailyCap(): boolean;
  destroy(): Promise<void>;
}

function toWhatsAppQueryNumber(mobile: string): string {
  // Excel stores bare 10-digit Indian mobile numbers; getNumberId() needs a
  // country code.
  return mobile.length === 10 ? `91${mobile}` : mobile;
}

export function createWhatsAppSender(options?: WhatsAppSenderOptions): WhatsAppSender {
  const countDir = options?.countDir ?? DEFAULT_COUNT_DIR;

  // 2-5 min randomized delay between sends — this drives a real personal
  // WhatsApp account, so the same reputation/ban-risk caution as email applies.
  const sendLimiter = createRateLimiter({
    minDelayMs: options?.minDelayMs ?? 2 * 60 * 1000,
    maxDelayMs: options?.maxDelayMs ?? 5 * 60 * 1000,
  });

  let clientPromise: Promise<Client> | null = null;
  function getClient(): Promise<Client> {
    if (!clientPromise) {
      clientPromise = new Promise<Client>((resolve, reject) => {
        const client = new Client({ authStrategy: new LocalAuth() });
        client.on("qr", (qr: string) => {
          logger.info("[whatsapp] scan this QR code with your phone (WhatsApp > Linked Devices):");
          qrcode.generate(qr, { small: true });
        });
        client.on("auth_failure", (message: string) => {
          reject(new Error(`WhatsApp authentication failed: ${message}`));
        });
        client.on("ready", () => {
          logger.info("[whatsapp] client ready");
          resolve(client);
        });
        client.initialize().catch(reject);
      });
    }
    return clientPromise;
  }

  function countFilePath(date = new Date()): string {
    return path.join(countDir, `whatsapp-count-${date.toISOString().slice(0, 10)}.json`);
  }

  function readCount(): number {
    const filePath = countFilePath();
    if (!fs.existsSync(filePath)) return 0;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return typeof data.count === "number" ? data.count : 0;
    } catch {
      return 0;
    }
  }

  function incrementCount(): void {
    if (!fs.existsSync(countDir)) fs.mkdirSync(countDir, { recursive: true });
    fs.writeFileSync(countFilePath(), JSON.stringify({ count: readCount() + 1 }, null, 2));
  }

  function hasReachedDailyCap(): boolean {
    return readCount() >= config.dailyWhatsappCap;
  }

  function log(to: string, status: string, error?: string): void {
    const line = `to=${to} status=${status}${error ? ` error="${error}"` : ""}`;
    writeLog("whatsapp-sends", line);
    logger.info(`[whatsapp] ${to}: ${status}${error ? ` (${error})` : ""}`);
  }

  async function attachResumeBestEffort(client: Client, chatId: string): Promise<void> {
    if (!fs.existsSync(config.resumePath)) return;
    try {
      const media = MessageMedia.fromFilePath(config.resumePath);
      await client.sendMessage(chatId, media, { caption: "My resume" });
    } catch (err) {
      logger.warn(
        `[whatsapp] failed to attach resume, skipping: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Routes one company row: skips landline-only/no-number rows without ever
   * touching the client, otherwise runs getNumberId() before ever sending —
   * if it resolves to null the number isn't on WhatsApp and sendMessage is
   * never called.
   */
  async function sendToRow(row: WhatsAppRow, message: string): Promise<WhatsAppOutcome> {
    if (!row.phoneMobile) {
      const status: WhatsAppStatus = row.phoneLandline ? "Skipped-Landline" : "Skipped-NoNumber";
      log(row.phoneLandline || "(no number)", status);
      return { status };
    }

    return sendLimiter.run(async () => {
      if (hasReachedDailyCap()) {
        const error = `daily WhatsApp cap (${config.dailyWhatsappCap}) reached`;
        logger.warn(`[whatsapp] ${error} — leaving remaining rows for the next run`);
        return { status: null, error };
      }

      try {
        const client = await getClient();
        const numberId = await client.getNumberId(toWhatsAppQueryNumber(row.phoneMobile));
        if (!numberId) {
          log(row.phoneMobile, "Failed-NotOnWhatsApp");
          return { status: "Failed-NotOnWhatsApp" };
        }

        if (!config.autopilot) {
          if (config.testWhatsappNumber) {
            const selfId = await client.getNumberId(toWhatsAppQueryNumber(config.testWhatsappNumber));
            if (selfId) {
              await client.sendMessage(selfId._serialized, `[TEST — would go to ${row.phoneMobile}]\n\n${message}`);
              incrementCount();
              log(row.phoneMobile, "Sent", "AUTOPILOT=false: sent to TEST_WHATSAPP_NUMBER instead");
              return { status: "Sent" };
            }
          }
          logger.info(`[whatsapp] AUTOPILOT=false — would send to ${row.phoneMobile}: ${message}`);
          writeLog("whatsapp-sends", `to=${row.phoneMobile} status=DRY-RUN message="${message.replace(/"/g, '\\"')}"`);
          return { status: null };
        }

        await client.sendMessage(numberId._serialized, message);
        await attachResumeBestEffort(client, numberId._serialized);
        incrementCount();
        log(row.phoneMobile, "Sent");
        return { status: "Sent" };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log(row.phoneMobile, "Error", error);
        return { status: null, error };
      }
    });
  }

  async function destroy(): Promise<void> {
    if (clientPromise) {
      const client = await clientPromise;
      await client.destroy();
      clientPromise = null;
    }
  }

  return { sendToRow, hasReachedDailyCap, destroy };
}

const defaultSender = createWhatsAppSender();
export const sendToRow = defaultSender.sendToRow;
export const hasReachedDailyCap = defaultSender.hasReachedDailyCap;
export const destroy = defaultSender.destroy;
