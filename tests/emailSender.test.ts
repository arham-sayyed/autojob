import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const sendMailMock = vi.fn().mockResolvedValue({ messageId: "fake-id" });

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
}));

import { createEmailSender } from "../src/email/sender";

describe("email/sender", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autojob-email-test-"));
    sendMailMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: "fake-id" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("redirects to SMTP_USER when AUTOPILOT is false (config default in test env)", async () => {
    const sender = createEmailSender({ sentCountDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });
    const result = await sender.sendEmail({
      to: "real-company@example.com",
      subject: "Hello",
      body: "Body text",
    });

    expect(result.success).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    // AUTOPILOT=false in the test env (tests/setup.ts) — must never go to the real company.
    expect(call.to).toBe(process.env.SMTP_USER);
    expect(call.subject).toBe("Hello");
  });

  it("increments the daily sent count on success and enforces the cap", async () => {
    const sender = createEmailSender({ sentCountDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });
    expect(sender.hasReachedDailyCap()).toBe(false);

    // DAILY_SEND_CAP=25 in the test env — send 25 to hit the cap.
    for (let i = 0; i < 25; i++) {
      const result = await sender.sendEmail({ to: "a@b.com", subject: `S${i}`, body: "b" });
      expect(result.success).toBe(true);
    }

    expect(sender.hasReachedDailyCap()).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(25);

    const blocked = await sender.sendEmail({ to: "a@b.com", subject: "over cap", body: "b" });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/daily send cap/i);
    expect(sendMailMock).toHaveBeenCalledTimes(25); // no additional send attempted
  });

  it("reports failure and logs it when the transport rejects", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("SMTP connection refused"));
    const sender = createEmailSender({ sentCountDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });

    const result = await sender.sendEmail({ to: "a@b.com", subject: "S", body: "b" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SMTP connection refused/);
    expect(sender.hasReachedDailyCap()).toBe(false); // failed sends don't count against the cap
  });
});
