import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const { getNumberIdMock, sendMessageMock, destroyMock, authState } = vi.hoisted(() => ({
  getNumberIdMock: vi.fn(),
  sendMessageMock: vi.fn(),
  destroyMock: vi.fn(),
  authState: { shouldFail: false },
}));

vi.mock("whatsapp-web.js", () => {
  class FakeClient {
    private handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    async initialize() {
      setTimeout(() => {
        if (authState.shouldFail) {
          this.handlers["auth_failure"]?.forEach((cb) => cb("bad QR session"));
        } else {
          this.handlers["ready"]?.forEach((cb) => cb());
        }
      }, 0);
    }
    getNumberId = getNumberIdMock;
    sendMessage = sendMessageMock;
    destroy = destroyMock;
  }
  return {
    Client: FakeClient,
    LocalAuth: class {},
    MessageMedia: { fromFilePath: vi.fn(() => ({})) },
  };
});

vi.mock("qrcode-terminal", () => ({ default: { generate: vi.fn() } }));

import { createWhatsAppSender } from "../src/whatsapp/sender";

describe("whatsapp/sender", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autojob-wa-test-"));
    getNumberIdMock.mockReset();
    sendMessageMock.mockReset().mockResolvedValue({});
    destroyMock.mockReset();
    authState.shouldFail = false;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips a landline-only row without ever touching the client", async () => {
    const sender = createWhatsAppSender({ countDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });
    const outcome = await sender.sendToRow({ phoneMobile: "", phoneLandline: "02212345678" }, "hi");
    expect(outcome.status).toBe("Skipped-Landline");
    expect(getNumberIdMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("skips a row with no number at all without ever touching the client", async () => {
    const sender = createWhatsAppSender({ countDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });
    const outcome = await sender.sendToRow({ phoneMobile: "", phoneLandline: "" }, "hi");
    expect(outcome.status).toBe("Skipped-NoNumber");
    expect(getNumberIdMock).not.toHaveBeenCalled();
  });

  it("marks Failed-NotOnWhatsApp when getNumberId resolves null, and never calls sendMessage", async () => {
    getNumberIdMock.mockResolvedValue(null);
    const sender = createWhatsAppSender({ countDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });
    const outcome = await sender.sendToRow({ phoneMobile: "9876543210", phoneLandline: "" }, "hi");
    expect(outcome.status).toBe("Failed-NotOnWhatsApp");
    expect(getNumberIdMock).toHaveBeenCalledWith("919876543210");
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("in dry-run mode (AUTOPILOT=false, no TEST_WHATSAPP_NUMBER) logs only and leaves status untouched", async () => {
    getNumberIdMock.mockResolvedValue({ _serialized: "919876543210@c.us" });
    const sender = createWhatsAppSender({ countDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });
    const outcome = await sender.sendToRow({ phoneMobile: "9876543210", phoneLandline: "" }, "hi there");
    expect(outcome.status).toBeNull();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("enforces the daily cap without touching the client once reached, and flags stopBatch", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(tmpDir, `whatsapp-count-${today}.json`), JSON.stringify({ count: 25 }));

    const sender = createWhatsAppSender({ countDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });
    expect(sender.hasReachedDailyCap()).toBe(true);

    const outcome = await sender.sendToRow({ phoneMobile: "9876543210", phoneLandline: "" }, "hi");
    expect(outcome.status).toBeNull();
    expect(outcome.error).toMatch(/daily whatsapp cap/i);
    expect(outcome.stopBatch).toBe(true);
    expect(getNumberIdMock).not.toHaveBeenCalled();
  });

  it("does not set stopBatch on a per-row transient error, so callers can skip and continue", async () => {
    // Regression: cap-reached and a one-off transient error used to be
    // indistinguishable to the caller (both were {status: null, error}),
    // so a single flaky lookup would abort the entire remaining batch.
    getNumberIdMock.mockRejectedValueOnce(new Error("network blip"));
    const sender = createWhatsAppSender({ countDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });
    const outcome = await sender.sendToRow({ phoneMobile: "9876543210", phoneLandline: "" }, "hi");
    expect(outcome.status).toBeNull();
    expect(outcome.error).toMatch(/network blip/);
    expect(outcome.stopBatch).toBeUndefined();
  });

  it("destroy() does not throw when the client never finished authenticating", async () => {
    // Regression: destroy() awaited a possibly-rejected clientPromise with
    // no try/catch, turning cleanup after a failed QR auth into an uncaught
    // throw at the very end of an otherwise-successful run.
    authState.shouldFail = true;
    const sender = createWhatsAppSender({ countDir: tmpDir, minDelayMs: 0, maxDelayMs: 0 });

    const outcome = await sender.sendToRow({ phoneMobile: "9876543210", phoneLandline: "" }, "hi");
    expect(outcome.status).toBeNull();
    expect(outcome.error).toMatch(/authentication failed/i);

    await expect(sender.destroy()).resolves.toBeUndefined();
    expect(destroyMock).not.toHaveBeenCalled(); // client object never resolved, nothing to destroy()
  });
});
