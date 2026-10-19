// Bike view: player centred, zoom fitted to 1 km ahead/behind, zooming to 300 m when a zombie is within 200 m, Track Up kept, drag holds the map ~6 s then returns. GPS is MOCKED (Playwright).
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const OUT = process.env.E2E_OUT ?? "e2e/out-bike";
import { mkdirSync } from "node:fs"; mkdirSync(OUT, { recursive: true });
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
const page = await ctx.newPage();
const tick = async (n = 3) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); } };
await page.goto(BASE + "/new"); await tick(4);
await page.getByRole("button", { name: "Bike", exact: true }).click();
await page.getByRole("button", { name: "SURVIVAL", exact: true }).click();
await page.getByRole("button", { name: "SHOW AREA" }).click();
await page.getByText(/Match length/).first().waitFor({ timeout: 90000 }); await tick();
await page.getByRole("button", { name: "START", exact: true }).click();
await page.waitForURL("**/play"); await tick();
await page.getByRole("dialog").getByRole("button", { name: "START" }).click();
await page.waitForTimeout(1500); await tick(2);
const map = page.locator('[data-testid="map"]');
const zoom = async () => Number(await map.getAttribute("data-zoom"));
const z0 = await zoom();
// Expected: 2000 m over the map height (844 px) at 59.4°N.
const mpp = (z) => (40075016.686 * Math.cos((59.40731 * Math.PI) / 180)) / (512 * 2 ** z);
const aheadM = (844 / 2) * mpp(z0);
check("bike view: 1 km ahead of the player", Math.abs(aheadM - 1000) < 40, `zoom ${z0}, ${aheadM.toFixed(0)} m to the edge`);
const box = await page.locator(".pmark").first().boundingBox();
check("player in the middle of the screen", box && Math.abs(box.y + box.height / 2 - 422) < 30 && Math.abs(box.x + box.width / 2 - 195) < 20, box ? `y=${Math.round(box.y + box.height / 2)}` : "no marker");
await page.screenshot({ path: `${OUT}/bike-default.png` });
// Zombie within 200 m: zoom in to ~300 m ahead, then back out when it is far away again.
const placeZombie = (target) => page.evaluate((target) => {
  const live = window.__outbreak.live; const pos = live.filter.position;
  const hav = (a, b) => { const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
  let best = null;
  for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 2) {
    const f = d / e.lengthM; const i = Math.min(e.geometry.length - 2, Math.floor(f * (e.geometry.length - 1))); const a = e.geometry[i], b = e.geometry[i + 1]; const t = f * (e.geometry.length - 1) - i;
    const ll = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    const diff = Math.abs(hav(ll, pos) - target); if (!best || diff < best.diff) best = { e: e.id, d, diff };
  }
  const z = live.state.zombies[0]; z.edgeId = best.e; z.distanceAlongEdgeM = best.d; z.route = []; z.speedMps = 0;
  for (const o of live.state.zombies.slice(1)) o.speedMps = 0;
  live.state.neutralUntilS = 9999;
}, target);
await placeZombie(120);
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(700); }
const zClose = await zoom();
const closeM = (844 / 2) * mpp(zClose);
check("zombie within 200 m: zoomed in to ~300 m ahead", Math.abs(closeM - 300) < 20, `zoom ${zClose}, ${closeM.toFixed(0)} m`);
const boxClose = await page.locator(".pmark").first().boundingBox();
check("player still in the middle when zoomed in", boxClose && Math.abs(boxClose.y + boxClose.height / 2 - 422) < 30);
await page.screenshot({ path: `${OUT}/bike-close.png` });
await placeZombie(700);
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(700); }
check("zombie far away again: back to the 1 km view", Math.abs((await zoom()) - z0) < 0.1, `zoom ${await zoom()}`);
// Drag the map: it must stay put and then return after about 6 s.
await page.mouse.move(200, 400); await page.mouse.down(); await page.mouse.move(200, 650, { steps: 8 }); await page.mouse.up();
await page.mouse.wheel(0, -400).catch(() => {});
await page.waitForTimeout(2500); await tick(2);
const dragged = await page.locator(".pmark").first().boundingBox();
check("map stays where the user left it", dragged && Math.abs(dragged.y + dragged.height / 2 - 422) > 60, dragged ? `y=${Math.round(dragged.y + dragged.height / 2)}` : "");
await page.screenshot({ path: `${OUT}/bike-dragged.png` });
for (let i = 0; i < 12; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(1000); }
const back = await page.locator(".pmark").first().boundingBox();
check("returns to the player in the middle after ~6 s", back && Math.abs(back.y + back.height / 2 - 422) < 30);
check("zoom returns to the bike zoom", Math.abs((await zoom()) - z0) < 0.1, `zoom ${await zoom()}`);
await browser.close();
process.exit(res.every(Boolean) ? 0 : 1);
