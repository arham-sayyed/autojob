import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

export async function generateReportPdf(html: string, outPath: string): Promise<void> {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: outPath, format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }
}
