// Mäter nätverk (anrop, bytes) och renderingsprestanda under en simulerad promenad. Mockad GPS, headless Chromium med mjukvarurendering
// (SwiftShader) – siffrorna är relativa jämförelser före/efter, inte absoluta telefonvärden.
import { chromium } from "playwright-core";
import { destPoint } from "./geo.mjs";
const BASE = process.env.BASE_URL;
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const WALK_S = Number(process.env.WALK_S ?? 120);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
const page = await ctx.newPage();
const reqs = [];
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
const urls = new Map();
cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
cdp.on("Network.loadingFinished", (e) => { const u = urls.get(e.requestId); if (u) reqs.push({ host: new URL(u).host, bytes: e.encodedDataLength, t: Date.now() }); });
await page.goto(BASE + "/new");
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
await page.waitForTimeout(800);
await page.getByRole("button", { name: "SURVIVAL", exact: true }).click();
await page.getByRole("button", { name: "START", exact: true }).click(); // Survival: START on the settings page goes straight to the game (no preview)
for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
await page.waitForURL("**/play", { timeout: 90000 });
await page.waitForSelector('[data-testid="map"][data-loaded="true"]');
for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
const dlgBtn = page.getByRole("dialog").getByRole("button", { name: "START" });
if (await dlgBtn.count()) await dlgBtn.click(); else await page.locator(".controls").getByRole("button", { name: "START" }).click();
await page.waitForTimeout(1500);
// Frame-timing + long tasks
await page.evaluate(() => { window.__f = []; window.__lt = 0; let l = performance.now(); const f = (n) => { window.__f.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); try { new PerformanceObserver((l) => { window.__lt += l.getEntries().length; }).observe({ entryTypes: ["longtask"] }); } catch {} });
const t0 = Date.now(); const n0 = reqs.length;
let p = { latitude: START.latitude, longitude: START.longitude };
const cpu0 = await page.evaluate(() => performance.now());
for (let i = 0; i < WALK_S; i++) {
  const bearing = i < WALK_S / 2 ? 45 : 135; // en 90°-sväng på halva vägen
  p = destPoint(p, Number(process.env.SPEED ?? 3), bearing);
  await ctx.setGeolocation({ ...p, accuracy: 6 });
  await page.waitForTimeout(1000);
}
const min = (Date.now() - t0) / 60000;
console.log("sanity: total requests since page load", reqs.length);
const mine = reqs.slice(n0);
const sum = (a) => a.reduce((s, q) => s + q.bytes, 0);
const own = mine.filter((q) => !q.host.includes("openfreemap")), tiles = mine.filter((q) => q.host.includes("openfreemap"));
const f = (await page.evaluate(() => window.__f)).sort((a, b) => a - b);
const lt = await page.evaluate(() => window.__lt);
const pct = (q) => f[Math.min(f.length - 1, Math.floor(f.length * q))];
console.log(JSON.stringify({
  build: BASE, minutes: +min.toFixed(2),
  ownRequestsPerMin: +(own.length / min).toFixed(1), ownKiBPerMin: +(sum(own) / min / 1024).toFixed(1),
  tileRequestsPerMin: +(tiles.length / min).toFixed(1), tileKiBPerMin: +(sum(tiles) / min / 1024).toFixed(1),
  totalKiBPerMin: +(sum(mine) / min / 1024).toFixed(1),
  frames: f.length, frameMsMedian: +pct(0.5).toFixed(1), frameMsP95: +pct(0.95).toFixed(1), frameMsMax: +f.at(-1).toFixed(1), longTasks: lt,
}));
await browser.close();
