// Game camera (ACTIVITY=bike|foot): AUTO = player a little below the middle (60 %), zoom fitted to 1 km / 600 m ahead (closing in to 300 / 225 m when a zombie is near); touching the map turns AUTO off and leaves the map to the player.
import { chromium } from "playwright-core";
const FOOT = process.env.ACTIVITY === "foot";
const AHEAD = FOOT ? 600 : 1000, CLOSE_AHEAD = FOOT ? 225 : 300, NEAR_M = FOOT ? 60 : 120, FAR_M = FOOT ? 500 : 700;
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
// One AUTO button: on = follow, Track Up, auto zoom. The first touch on the map hands it to the player at once (AUTO off), so the gesture is never cancelled.
const autoBtn = page.getByRole("button", { name: /^AUTO/ });
const pressed = async () => (await autoBtn.getAttribute("aria-pressed")) === "true";
check("AUTO is on at the start", await pressed());
const pm = async () => { const b = await page.locator(".pmark").first().boundingBox(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; };
const zBefore = await zoom();
await page.mouse.move(195, 300); await page.mouse.wheel(0, 300); await page.waitForTimeout(700);
check("the first wheel step turns AUTO off", !(await pressed()));
check("… and already zooms the map (not swallowed)", (await zoom()) < zBefore - 0.15, `zoom ${await zoom()} (was ${zBefore})`);
// Drag while GPS fixes keep arriving: the map follows the finger the whole way.
const p0 = await pm();
let dragging = true;
const fixes = (async () => { while (dragging) { await ctx.setGeolocation(START); await page.waitForTimeout(150); } })();
await page.mouse.move(200, 400); await page.mouse.down(); await page.mouse.move(200, 650, { steps: 12 }); await page.mouse.up();
dragging = false; await fixes; await page.waitForTimeout(400);
const p1 = await pm();
check("a drag moves the map by the drag distance, also while fixes arrive", p0 && p1 && Math.abs(p1.y - p0.y - 250) < 30, p0 && p1 ? `moved ${Math.round(p1.y - p0.y)} px` : "");
// AUTO off: the game never moves the map by itself (no return to the player, no zoom for a close zombie).
const zUser = await zoom();
await placeZombie(NEAR_M);
for (let i = 0; i < 8; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(1000); }
const p2 = await pm();
check("AUTO off: the map stays where the user left it", p1 && p2 && Math.abs(p2.y - p1.y) < 3 && Math.abs(p2.x - p1.x) < 3);
check("AUTO off: a close zombie does not change the zoom", Math.abs((await zoom()) - zUser) < 0.02, `zoom ${await zoom()} (user ${zUser})`);
await page.screenshot({ path: `${OUT}/manual.png` });
// AUTO again: back to the player, at the close zoom (the zombie is still near), then wide again when it is gone.
await autoBtn.click(); await page.waitForTimeout(1200); await tick(3);
check("tapping AUTO turns it on again", await pressed());
const p3 = await pm();
check("AUTO again: the player is back a little below the middle", p3 && Math.abs(p3.y - PY) < 30 && Math.abs(p3.x - 195) < 20, p3 ? `y=${Math.round(p3.y)}` : "");
check("AUTO again: close zoom for the near zombie", Math.abs(PY * mpp(await zoom()) - CLOSE_AHEAD) < CLOSE_AHEAD * 0.07, `zoom ${await zoom()}`);
await placeZombie(FAR_M);
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(700); }
check("AUTO: wide view again when the zombie is far", Math.abs((await zoom()) - z0) < 0.1, `zoom ${await zoom()}`);
await page.screenshot({ path: `${OUT}/auto.png` });
await browser.close();
process.exit(res.every(Boolean) ? 0 : 1);
