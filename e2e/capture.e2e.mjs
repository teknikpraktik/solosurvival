// Captured: skrämbild + skrik-cue, sedan resultatdialog utan X. GPS är MOCKAD (Playwright). Ljudet kan inte avlyssnas här; vi kontrollerar bild, tidsordning och att ljudfilen hämtas.
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const OUT = process.env.E2E_OUT ?? "e2e/out-capture";
import { mkdirSync } from "node:fs"; mkdirSync(OUT, { recursive: true });
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
const page = await ctx.newPage();
const reqs = []; page.on("request", (r) => reqs.push(r.url()));
await page.goto(BASE + "/new");
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
await page.getByRole("button", { name: "SURVIVAL", exact: true }).click();
await page.getByRole("button", { name: "START", exact: true }).click(); // Survival: START on the settings page goes straight to the game (no preview)
for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
await page.waitForURL("**/play", { timeout: 90000 });
for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
await page.getByRole("dialog").getByRole("button", { name: "START" }).click({ timeout: 2500 }).catch(() => {}); // no "Ready to start" dialog any more: START GAME starts the match
await page.waitForTimeout(800);
// Zombie ~3 m från spelaren.
await page.evaluate(() => {
  const live = window.__outbreak.live; const pos = live.filter.position;
  const hav = (a, b) => { const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
  let best = null;
  for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 2) {
    const f = d / e.lengthM; const i = Math.min(e.geometry.length - 2, Math.floor(f * (e.geometry.length - 1))); const a = e.geometry[i], b = e.geometry[i + 1]; const t = f * (e.geometry.length - 1) - i;
    const ll = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    const diff = Math.abs(hav(ll, pos) - 4); if (!best || diff < best.diff) best = { e: e.id, d, diff };
  }
  const z = live.state.zombies[0]; z.edgeId = best.e; z.distanceAlongEdgeM = best.d; z.route = []; z.speedMps = 0;
  live.state.neutralUntilS = 0;
});
let scareSeen = false;
for (let i = 0; i < 14 && !scareSeen; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(1000); scareSeen = (await page.locator(".scare").count()) > 0; }
check("skräm-overlay visas när man blir fångad", scareSeen);
if (scareSeen) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/scare.png` });
  check("skrämbilden laddas (lokal bild)", await page.locator(".scare img").evaluate((i) => i.complete && i.naturalWidth > 0));
  check("skrik-ljudfilen har hämtats", reqs.some((u) => u.includes("/audio/captured-scream.wav")));
  await page.getByRole("dialog", { name: "GAME OVER" }).waitFor({ timeout: 10000 });
  check("resultatdialog efter skrämman", true);
  check("resultatdialogen saknar X (obligatoriskt beslut)", (await page.getByRole("dialog").getByRole("button", { name: "Close" }).count()) === 0);
  await page.screenshot({ path: `${OUT}/result.png` });
}
await browser.close();
process.exit(res.every(Boolean) ? 0 : 1);
