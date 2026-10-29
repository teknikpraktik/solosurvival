// Game camera (ACTIVITY=bike|foot): player a little below the middle (60 %), auto zoom fitted to 1 km / 400 m ahead (closing in to 300 / 150 m when a zombie is near; the auto zoom button turns this off), Track Up kept, drag + zoom hold the map for ~15 s, then the position returns but the user's zoom is kept until the centre button is tapped. GPS is MOCKED (Playwright).
import { chromium } from "playwright-core";
const FOOT = process.env.ACTIVITY === "foot";
const AHEAD = FOOT ? 400 : 1000, CLOSE_AHEAD = FOOT ? 150 : 300, NEAR_M = FOOT ? 60 : 120, FAR_M = FOOT ? 500 : 700;
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const PY = 0.6 * 844; // the player's height on the screen (px)
const OUT = process.env.E2E_OUT ?? (FOOT ? "e2e/out-foot" : "e2e/out-bike");
import { mkdirSync } from "node:fs"; mkdirSync(OUT, { recursive: true });
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
const page = await ctx.newPage();
const tick = async (n = 3) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); } };
await page.goto(BASE + "/new"); await tick(4);
await page.getByRole("button", { name: FOOT ? "On foot" : "Bike", exact: true }).click();
await page.getByRole("button", { name: "SURVIVAL", exact: true }).click();
await page.getByRole("button", { name: "START", exact: true }).click(); await tick(); // Survival: START on the settings page goes straight to the game (no preview)
await page.waitForURL("**/play", { timeout: 90000 }); await tick();
await page.getByRole("dialog").getByRole("button", { name: "START" }).click();
await page.waitForTimeout(1500); await tick(2);
const map = page.locator('[data-testid="map"]');
const zoom = async () => Number(await map.getAttribute("data-zoom"));
const z0 = await zoom();
// Expected: AHEAD between the player and the top edge at 59.4°N.
const mpp = (z) => (40075016.686 * Math.cos((59.40731 * Math.PI) / 180)) / (512 * 2 ** z);
const aheadM = PY * mpp(z0);
check("view: normal distance ahead of the player", Math.abs(aheadM - AHEAD) < AHEAD * 0.04, `zoom ${z0}, ${aheadM.toFixed(0)} m to the edge`);
const box = await page.locator(".pmark").first().boundingBox();
check("player a little below the middle of the screen", box && Math.abs(box.y + box.height / 2 - PY) < 30 && Math.abs(box.x + box.width / 2 - 195) < 20, box ? `y=${Math.round(box.y + box.height / 2)}` : "no marker");
await page.screenshot({ path: `${OUT}/default.png` });
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
await placeZombie(NEAR_M);
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(700); }
const zClose = await zoom();
const closeM = PY * mpp(zClose);
check("zombie near: zoomed in to the close distance", Math.abs(closeM - CLOSE_AHEAD) < CLOSE_AHEAD * 0.07, `zoom ${zClose}, ${closeM.toFixed(0)} m`);
const boxClose = await page.locator(".pmark").first().boundingBox();
check("player still at the same height when zoomed in", boxClose && Math.abs(boxClose.y + boxClose.height / 2 - PY) < 30);
await page.screenshot({ path: `${OUT}/close.png` });
await placeZombie(FAR_M);
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(700); }
check("zombie far away again: back to the normal view", Math.abs((await zoom()) - z0) < 0.1, `zoom ${await zoom()}`);
// Auto zoom off: a close zombie no longer changes the zoom; on again: the close view returns.
const autoBtn = page.getByRole("button", { name: /^Auto zoom/ });
check("auto zoom is on at the start", (await autoBtn.getAttribute("aria-pressed")) === "true");
await autoBtn.click(); await tick(2);
check("auto zoom button turns it off", (await autoBtn.getAttribute("aria-pressed")) === "false");
await placeZombie(NEAR_M);
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(700); }
check("auto zoom off: a close zombie does NOT change the zoom", Math.abs((await zoom()) - z0) < 0.05, `zoom ${await zoom()} (was ${z0})`);
await autoBtn.click(); await page.waitForTimeout(1200); await tick(3);
check("auto zoom on again: zoomed in to the close distance", Math.abs(PY * mpp(await zoom()) - CLOSE_AHEAD) < CLOSE_AHEAD * 0.07, `zoom ${await zoom()}`);
await placeZombie(FAR_M);
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(700); }
// Drag and zoom out by hand: the map must stay put; after ~15 s the position returns, the zoom the user chose stays until "centre" is tapped.
await page.mouse.move(200, 400); await page.mouse.down(); await page.mouse.move(200, 650, { steps: 8 }); await page.mouse.up();
await page.mouse.move(195, 300); await page.mouse.wheel(0, 500);
await page.waitForTimeout(2500); await tick(2);
const zUser = await zoom();
check("manual zoom out changed the zoom", zUser < z0 - 0.3, `zoom ${zUser} (auto ${z0})`);
const dragged = await page.locator(".pmark").first().boundingBox();
check("map stays where the user left it", dragged && Math.abs(dragged.y + dragged.height / 2 - PY) > 60, dragged ? `y=${Math.round(dragged.y + dragged.height / 2)}` : "");
await page.screenshot({ path: `${OUT}/dragged.png` });
for (let i = 0; i < 8; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(1000); }
const still = await page.locator(".pmark").first().boundingBox();
check("still held after 8 s (not the old 6 s)", still && Math.abs(still.y + still.height / 2 - PY) > 60);
for (let i = 0; i < 12; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(1000); }
const back = await page.locator(".pmark").first().boundingBox();
check("returns to the player after ~15 s", back && Math.abs(back.y + back.height / 2 - PY) < 30);
check("the zoom the user chose is kept (no automatic reset)", Math.abs((await zoom()) - zUser) < 0.1, `zoom ${await zoom()} (user ${zUser}, auto ${z0})`);
await page.getByRole("button", { name: "Center on me" }).click(); await page.waitForTimeout(1200); await tick(2);
check("centre button restores the automatic zoom", Math.abs((await zoom()) - z0) < 0.1, `zoom ${await zoom()}`);
await browser.close();
process.exit(res.every(Boolean) ? 0 : 1);
