import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../site", import.meta.url));
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer(async (request, response) => {
  let pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/") pathname = "/index.html";
  else if (!path.extname(pathname)) pathname += ".html";
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  for (const width of [1440, 844, 390, 375]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    for (const route of ["/", "/changelog", "/privacy", "/terms", "/refunds", "/welcome"]) {
      const response = await page.goto(origin + route);
      assert.equal(response.status(), 200, route);
      const layout = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll("body *")]
          .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8).map((element) => `${element.tagName}.${element.className}`),
      }));
      assert.ok(layout.width <= width + 1, `${route} overflows at ${width}px: ${layout.overflowing.join(", ")}`);
      if (route === "/") assert.ok((await page.content()).includes(`Pitwall-${version}-arm64.dmg?release=${version}`));
      if (route === "/changelog") assert.equal(await page.locator(".release-version").first().innerText(), version);
    }
    console.log(`  OK  website pages fit ${width}px and advertise ${version}`);
  }
  assert.deepEqual(errors, []);
  console.log("Pitwall website smoke test passed.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
