import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { backupExcel } from "../src/storage/backup";

describe("storage/backup", () => {
  let tmpDir: string;
  let sourcePath: string;
  let destDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autojob-backup-test-"));
    sourcePath = path.join(tmpDir, "companies.xlsx");
    destDir = path.join(tmpDir, "backups");
    fs.writeFileSync(sourcePath, "fake-xlsx-content");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null and does nothing when the source file doesn't exist", () => {
    const missing = path.join(tmpDir, "does-not-exist.xlsx");
    expect(backupExcel(missing, destDir)).toBeNull();
    expect(fs.existsSync(destDir)).toBe(false);
  });

  it("copies the file into destDir with a timestamped name", () => {
    const backupPath = backupExcel(sourcePath, destDir);
    expect(backupPath).not.toBeNull();
    expect(fs.existsSync(backupPath!)).toBe(true);
    expect(path.dirname(backupPath!)).toBe(destDir);
    expect(path.basename(backupPath!)).toMatch(/^companies-.+\.xlsx$/);
    expect(fs.readFileSync(backupPath!, "utf-8")).toBe("fake-xlsx-content");
  });

  it("creates destDir if it doesn't exist yet", () => {
    expect(fs.existsSync(destDir)).toBe(false);
    backupExcel(sourcePath, destDir);
    expect(fs.existsSync(destDir)).toBe(true);
  });

  it("creates a distinctly-named backup on each call", async () => {
    const first = backupExcel(sourcePath, destDir);
    await new Promise((r) => setTimeout(r, 10));
    const second = backupExcel(sourcePath, destDir);
    expect(first).not.toBe(second);
  });
});
