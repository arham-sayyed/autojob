import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { runStage } from "../src/utils/gracefulExit";

describe("utils/gracefulExit", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("runs the stage normally when it succeeds", async () => {
    let ran = false;
    await runStage("test-stage", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("catches a thrown error, logs it, and exits non-zero", async () => {
    await expect(
      runStage("test-stage", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();

    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.resolve(__dirname, "..", "logs", `errors-${today}.log`);
    expect(fs.existsSync(logPath)).toBe(true);
    const contents = fs.readFileSync(logPath, "utf-8");
    expect(contents).toContain("test-stage");
    expect(contents).toContain("boom");
  });
});
