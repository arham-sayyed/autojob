import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createExcelStore } from "../src/storage/excel";

describe("storage/excel", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autojob-excel-test-"));
    filePath = path.join(tmpDir, "companies.xlsx");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the file with headers on first write", async () => {
    const store = createExcelStore(filePath);
    await store.upsert({ website: "https://acme.com", companyName: "Acme" });

    expect(fs.existsSync(filePath)).toBe(true);
    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].companyName).toBe("Acme");
  });

  it("round-trips 3 upserted rows through reload", async () => {
    const store = createExcelStore(filePath);
    await store.upsert({ website: "https://acme.com", companyName: "Acme", googleRating: 4.5 });
    await store.upsert({ website: "https://beta.io", companyName: "Beta", fitScore: 60 });
    await store.upsert({
      website: "https://gamma.dev",
      companyName: "Gamma",
      dateScraped: new Date("2026-01-15T00:00:00.000Z"),
    });

    // Reload from a fresh store instance pointed at the same file to prove
    // the data survives a real disk round-trip, not just in-memory state.
    const reloaded = createExcelStore(filePath);
    const all = await reloaded.loadAll();

    expect(all).toHaveLength(3);
    const acme = all.find((r) => r.website === "https://acme.com");
    expect(acme?.companyName).toBe("Acme");
    expect(acme?.googleRating).toBe(4.5);

    const beta = all.find((r) => r.website === "https://beta.io");
    expect(beta?.fitScore).toBe(60);

    const gamma = all.find((r) => r.website === "https://gamma.dev");
    expect(gamma?.dateScraped?.toISOString().slice(0, 10)).toBe("2026-01-15");
  });

  it("upserting the same website twice updates instead of duplicating", async () => {
    const store = createExcelStore(filePath);
    await store.upsert({ website: "https://acme.com", companyName: "Acme", status: "New" });
    await store.upsert({ website: "https://acme.com", status: "EmailFound", email: "hr@acme.com" });

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].companyName).toBe("Acme");
    expect(all[0].status).toBe("EmailFound");
    expect(all[0].email).toBe("hr@acme.com");
  });

  it("normalizes website casing/trailing slash for dedup", async () => {
    const store = createExcelStore(filePath);
    await store.upsert({ website: "https://Acme.com/", companyName: "Acme" });
    await store.upsert({ website: "https://acme.com", status: "EmailFound" });

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].website).toBe("https://acme.com");
    expect(all[0].status).toBe("EmailFound");
  });

  it("getByStatus filters correctly", async () => {
    const store = createExcelStore(filePath);
    await store.upsert({ website: "https://a.com", status: "New" });
    await store.upsert({ website: "https://b.com", status: "Emailed" });
    await store.upsert({ website: "https://c.com", status: "Emailed" });

    const emailed = await store.getByStatus(["Emailed"]);
    expect(emailed).toHaveLength(2);
    expect(emailed.map((r) => r.website).sort()).toEqual(["https://b.com", "https://c.com"]);
  });

  it("markStatus updates status and extra fields on an existing row", async () => {
    const store = createExcelStore(filePath);
    await store.upsert({ website: "https://a.com", status: "New" });

    await store.markStatus("https://a.com", "Emailed", { dateEmailed: new Date("2026-02-01") });

    const all = await store.loadAll();
    expect(all[0].status).toBe("Emailed");
    expect(all[0].dateEmailed?.toISOString().slice(0, 10)).toBe("2026-02-01");
  });

  it("markStatus throws for an unknown website", async () => {
    const store = createExcelStore(filePath);
    await expect(store.markStatus("https://nope.com", "Emailed")).rejects.toThrow();
  });

  describe("upsertMany", () => {
    it("writes N rows in a single read+write and round-trips them all", async () => {
      const store = createExcelStore(filePath);
      await store.upsertMany([
        { website: "https://a.com", companyName: "A" },
        { website: "https://b.com", companyName: "B" },
        { website: "https://c.com", companyName: "C" },
      ]);

      const all = await store.loadAll();
      expect(all).toHaveLength(3);
      expect(all.map((r) => r.companyName).sort()).toEqual(["A", "B", "C"]);
    });

    it("dedupes against existing rows the same way upsert() does", async () => {
      const store = createExcelStore(filePath);
      await store.upsert({ website: "https://a.com", companyName: "A", status: "EmailFound" });

      await store.upsertMany([
        { website: "https://a.com", companyName: "A Updated" }, // should update, not duplicate
        { website: "https://d.com", companyName: "D" },
      ]);

      const all = await store.loadAll();
      expect(all).toHaveLength(2);
      const a = all.find((r) => r.website === "https://a.com");
      expect(a?.companyName).toBe("A Updated");
      expect(a?.status).toBe("EmailFound"); // untouched field preserved
    });

    it("dedupes duplicate websites within the same batch, last write wins", async () => {
      const store = createExcelStore(filePath);
      await store.upsertMany([
        { website: "https://a.com", companyName: "First" },
        { website: "https://a.com", companyName: "Second" },
      ]);

      const all = await store.loadAll();
      expect(all).toHaveLength(1);
      expect(all[0].companyName).toBe("Second");
    });

    it("is a no-op for an empty array (does not create the file)", async () => {
      const store = createExcelStore(filePath);
      await store.upsertMany([]);
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });
});
