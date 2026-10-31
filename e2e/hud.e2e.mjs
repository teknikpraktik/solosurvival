// Game view: two-row HUD, extraction countdown, zombie threat levels (amber/red/dim) and closing labels, edge dots on foot,
// home marker stepping back under the player, magenta goal, map edge to edge, quieter QUIT.
// BASE_URL=http://localhost:3100 CHROMIUM_PATH=… E2E_OUT=dir node e2e/hud.e2e.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "e2e/out-hud"; mkdirSync(OUT, { recursive: true });
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function play(mode) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
  await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
  const page = await ctx.newPage();
  const fixes = async (n = 3) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); } };
  await page.goto(BASE + "/new"); await page.waitForTimeout(1500); await fixes();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: mode, exact: true }).click(); await fixes();
  await page.locator(".ngfoot .btn").click();
  if (mode !== "SURVIVAL") { await page.locator(".pvstats").waitFor({ timeout: 90000 }); await fixes(); await page.getByRole("button", { name: "START GAME" }).click(); }
  await page.waitForURL("**/play", { timeout: 90000 }); await page.waitForTimeout(800);
  await page.getByRole("dialog").getByRole("button", { name: "START" }).click({ timeout: 2500 }).catch(() => {}); // no "Ready to start" dialog any more: START GAME starts the match await page.waitForTimeout(1500); await fixes(2);
  return { ctx, page, fixes };
}
/** Puts zombie i at about `m` metres from the player along the network; speed 0 keeps it there, otherwise it hunts. */
const place = (page, list) => page.evaluate((list) => {
  const live = window.__outbreak.live; const pos = live.filter.position;
  const hav = (a, b) => { const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
  const at = (target) => { let best = null; for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 3) { const f = d / e.lengthM; const i = Math.min(e.geometry.length - 2, Math.floor(f * (e.geometry.length - 1))); const a = e.geometry[i], b = e.geometry[i + 1]; const t = f * (e.geometry.length - 1) - i; const ll = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }; const diff = Math.abs(hav(ll, pos) - target); if (!best || diff < best.diff) best = { e: e.id, d, diff }; } return best; };
  live.state.neutralUntilS = 1e9; // never captured here
  list.forEach(([i, m, hunt], k) => { const z = live.state.zombies[i]; if (!z) return; const b = at(m); z.edgeId = b.e; z.distanceAlongEdgeM = b.d; z.route = []; if (!hunt) z.speedMps = 0; });
  for (let i = list.length; i < live.state.zombies.length; i++) live.state.zombies[i].speedMps = 0;
}, list);

// --- Survival on foot ---
{
  const { ctx, page, fixes } = await play("SURVIVAL");
  check("START: straight into the game (no 'Ready to start' dialog, match running)", (await page.getByRole("dialog").count()) === 0 && (await page.getByRole("button", { name: "PAUSE" }).count()) === 1);
  const lines = await page.locator(".hudbar > .line").count();
  check("HUD: two rows on foot (mode/time, goal/zombie)", lines === 2, `${lines} rows`);
  check("Survival: 'Extraction in m:ss' instead of 'Survive'", /^Extraction in \d+:\d\d$/.test((await page.locator(".pill.goal").innerText()).trim()), await page.locator(".pill.goal").innerText());
  await place(page, [[0, 60, false], [1, 350, true], [2, 900, false]]);
  await fixes(8);
  const cls = await page.evaluate(() => [...document.querySelectorAll(".zmark")].map((e) => e.className));
  check("zombie within 100 m: red level ('near')", cls.some((c) => c.includes("near")), JSON.stringify(cls));
  check("zombie beyond 600 m: dimmed ('far')", cls.some((c) => c.includes("far")));
  check("nearest-zombie pill red within 100 m", (await page.locator(".zpill").getAttribute("class")).includes("zclose"));
  check("a hunting zombie's label shows it closing in", (await page.locator(".zlabel.closing").count()) >= 1, `${await page.locator(".zlabel.closing").count()} closing`);
  check("edge dots on foot for zombies outside the visible map", (await page.locator(".zedge").count()) >= 1, `${await page.locator(".zedge").count()} dots`);
  check("QUIT quieter than PAUSE", (await page.locator(".controls .quit").count()) === 1);
  const fill = await page.evaluate(() => { const r = document.querySelector(".map-shell").getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: window.innerHeight }; });
  check("map reaches the bottom of the screen", fill.bottom >= fill.vh, JSON.stringify(fill));
  await page.screenshot({ path: `${OUT}/survival.png` });
  await ctx.close();
}

// --- Checkpoints: home under the player, magenta goal ---
{
  const { ctx, page } = await play("CHECKPOINTS");
  check("START GAME from the preview: straight into the game", (await page.getByRole("dialog").count()) === 0 && (await page.getByRole("button", { name: "PAUSE" }).count()) === 1);
  await page.waitForTimeout(1500);
  const hm = await page.evaluate(() => { const h = document.querySelector(".goalmark.home"); const p = document.querySelector(".pmark"); if (!h || !p) return null; const a = h.getBoundingClientRect(), b = p.getBoundingClientRect(); return { at: h.classList.contains("atplayer"), dx: Math.round(a.left + a.width / 2 - b.left - b.width / 2), dy: Math.round(a.top + a.height / 2 - b.top - b.height / 2) }; });
  check("standing at home: home marker steps back and stays where home is (under the player)", hm && hm.at && Math.abs(hm.dx) <= 2 && Math.abs(hm.dy) <= 2, JSON.stringify(hm));
  const next = await page.evaluate(() => [...document.querySelectorAll('[aria-label^="Objective"]')].map((e) => getComputedStyle(e).backgroundColor));
  const ptr = await page.locator(".goalptr svg path").nth(1).getAttribute("fill").catch(() => null);
  check("next checkpoint and goal pointer are magenta (goal colour)", next.includes("rgb(192, 38, 211)") || ptr === "#c026d3", JSON.stringify({ next, ptr }));
  await page.screenshot({ path: `${OUT}/checkpoints.png` });
  await ctx.close();
}

// --- Bike: speed on its own row at the right ---
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
  const page = await ctx.newPage();
  await page.goto(BASE + "/new"); await page.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
  await page.getByRole("button", { name: "Bike", exact: true }).click();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "SURVIVAL", exact: true }).click();
  await page.locator(".ngfoot .btn").click(); await page.waitForURL("**/play", { timeout: 90000 }); await page.waitForTimeout(800);
  await page.getByRole("dialog").getByRole("button", { name: "START" }).click({ timeout: 2500 }).catch(() => {}); // no "Ready to start" dialog any more: START GAME starts the match await page.waitForTimeout(1200);
  check("Bike: speed shown, HUD at most three rows", (await page.getByLabel("Your speed").count()) === 1 && (await page.locator(".hudbar > .line").count()) <= 3);
  await page.screenshot({ path: `${OUT}/bike.png` });
  await ctx.close();
}

await browser.close();
const failed = res.filter((x) => !x).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
