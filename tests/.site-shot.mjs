import { chromium } from "playwright";
const out = process.argv[2]; const url = process.argv[3] || "https://braveli.app/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("is-in", "in", "visible")));
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
