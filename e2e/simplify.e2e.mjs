// UI simplification after the field test: start page (no Simulator, rings logo), How to play, New game without LAST SETUP or the
// settings toggle, every mode × activity, distance and time on foot and by bike (left, no overlap), and the QUIT flow.
// GPS is MOCKED (Playwright); movement is simulated by moving the mocked position. Checks layout and state, not field behaviour.
// BASE_URL=http://localhost:3100 [SHOTS=dir] node e2e/simplify.e2e.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
const VP = { width: 360, height: 740 };
async function open(vp = VP) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
  await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); localStorage.setItem("outbreak.cues", "off"); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  let pos = { ...START };
  const wait = async (ms) => { for (let t = 0; t < ms; t += 400) { await ctx.setGeolocation(pos); await page.waitForTimeout(400); } };
  /** Walks north `secs` seconds at about 2 m/s (one fix per second). */
  const walk = async (secs) => { for (let i = 0; i < secs; i++) { pos = { ...pos, latitude: pos.latitude + 0.000018 }; await ctx.setGeolocation(pos); await page.waitForTimeout(1000); } };
  const home = () => { pos = { ...START }; };
  return { ctx, page, wait, walk, home };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const hscroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const view = (page) => page.evaluate(() => { const v = window.__outbreak?.getView(); return { stage: v?.stage, match: v?.match ? { id: v.match.id, paused: v.match.paused, phase: v.match.phase, elapsedS: v.match.elapsedS, distanceM: v.match.distanceM, activity: v.match.activity } : null }; });
async function toSetup(o, act, mode) {
  await o.page.goto(BASE + "/new"); await o.wait(1200);
  await o.page.getByRole("button", { name: act, exact: true }).click();
  await o.page.getByRole("button", { name: mode, exact: true }).click(); await o.wait(600);
}
async function startFromSetup(o, mode) {
  const { page, wait } = o;
  if (mode === "A TO B") {
    await page.waitForSelector('[data-loaded="true"]', { timeout: 20000, state: "attached" }); await wait(1200);
    for (const [x, y] of [[280, 200], [100, 190], [290, 300], [80, 300], [190, 140], [320, 240]]) {
      await page.mouse.click(x, y); await wait(600);
      if ((await page.locator('[aria-label="Objective B"]').count()) === 0) continue;
      if (await page.locator(".pvstats").waitFor({ timeout: 60000 }).then(() => true, () => false) && await page.getByRole("button", { name: "START GAME" }).isEnabled()) break;
    }
  } else if (mode === "CHECKPOINTS") await page.locator(".pvstats").waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: "START GAME" }).click();
  await page.waitForURL("**/play", { timeout: 90000 });
  for (let i = 0; i < 40 && !(await page.evaluate(() => { const m = window.__outbreak?.getView().match; return !!m && !m.paused; })); i++) await wait(400);
}
/** Boxes of the HUD parts, to check that the trip field overlaps nothing. */
const boxes = (page) => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const others = [...document.querySelectorAll(".hudbar .pill:not(.tripstats), .controls button, .maplibregl-ctrl-scale, .infect")].map(r);
  return { trip: r(document.querySelector(".pill.tripstats")), others, vw: innerWidth };
});
const overlaps = (a, b) => a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;

// --- Start page and How to play ---
{
  const o = await open();
  await o.page.goto(BASE + "/"); await o.page.waitForTimeout(1200);
  check("start page: no Simulator link", (await o.page.getByRole("link", { name: /simulator/i }).count()) === 0);
  check("start page: the simulator itself still exists (/dev)", (await o.page.request.get(BASE + "/dev")).ok());
  const logo = await o.page.locator("img.herologo").evaluate((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.getAttribute("src"), w: Math.round(i.getBoundingClientRect().width), above: i.getBoundingClientRect().bottom <= document.querySelector("h1.title").getBoundingClientRect().top + 8 }));
  check("start page: the rings logo above OUTBREAK", logo.ok && logo.src === "/img/logo-rings.png" && logo.above && logo.w >= 80, JSON.stringify(logo));
  const alpha = await o.page.evaluate(async () => { const i = await createImageBitmap(await (await fetch("/img/logo-rings.png")).blob()); const c = new OffscreenCanvas(i.width, i.height); const x = c.getContext("2d"); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, i.width, i.height).data; const at = (px, py) => d[(py * i.width + px) * 4 + 3]; return { corner: at(2, 2), centre: at(i.width >> 1, i.height >> 1), ring: at(i.width >> 1, 4) }; });
  check("logo: transparent outside and between the rings, opaque on the rings", alpha.corner === 0 && alpha.centre === 0 && alpha.ring > 200, JSON.stringify(alpha));
  const mani = await (await o.page.request.get(BASE + "/manifest.webmanifest")).json();
  const icons = [];
  for (const i of mani.icons) icons.push((await o.page.request.get(BASE + i.src)).ok() && i.src.includes("v=6"));
  check("home screen: manifest icons (any + maskable) served, new version", icons.length === 3 && icons.every(Boolean) && mani.icons.some((i) => i.purpose === "maskable"));
  check("home screen: apple-touch-icon served", (await o.page.request.get(BASE + "/icons/apple-touch-icon.png?v=6")).ok() && (await o.page.locator('link[rel="apple-touch-icon"]').getAttribute("href")).includes("v=6"));
  check("start page: no sideways scrolling", !(await hscroll(o.page)));
  await shot(o.page, "01-start");
  await o.page.getByRole("link", { name: "HOW TO PLAY" }).click(); await o.page.waitForURL("**/how-to-play");
  const heads = await o.page.locator("main h2").allInnerTexts();
  const want = ["Start a match", "Game modes", "Win or lose", "Difficulty", "Zombies and capture", "During the match", "Location and your surroundings"];
  check("How to play: the new sections in order", want.every((h, i) => heads.indexOf(h) >= 0 && (i === 0 || heads.indexOf(h) > heads.indexOf(want[i - 1]))), heads.join(" | "));
  const text = await o.page.locator("main").innerText();
  check("How to play: describes only what exists (no ride-through, no Simulator, no LAST SETUP)", !/ride through|25 km\/h|simulator|last setup/i.test(text));
  check("How to play: no sideways scrolling at 360 px", !(await hscroll(o.page)));
  await shot(o.page, "02-howto");
  await o.ctx.close();
}

// --- Every mode × activity: setup and the trip field in the game ---
for (const act of ["ON FOOT", "BY BIKE"]) {
  for (const mode of ["CHECKPOINTS", "A TO B", "SURVIVAL"]) {
    const tag = `${act} · ${mode}`;
    const o = await open(); const { page } = o;
    await page.goto(BASE + "/new"); await o.wait(1000);
    check(`${tag}: New game has no LAST SETUP`, (await page.locator(".lastsetup").count()) === 0 && (await page.getByText(/last setup/i).count()) === 0);
    await toSetup(o, act, mode);
    check(`${tag}: no settings toggle; difficulty row visible directly`, (await page.locator(".pvtoggle").count()) === 0 && (await page.getByRole("group", { name: "Difficulty" }).isVisible()));
    await page.getByRole("button", { name: "Easy", exact: true }).click(); await page.waitForTimeout(150);
    check(`${tag}: Easy chosen with one tap`, (await page.getByRole("button", { name: "Easy", exact: true }).getAttribute("aria-pressed")) === "true");
    if (mode === "SURVIVAL") {
      await page.locator("#dur").fill(act === "BY BIKE" ? "40" : "25"); await page.waitForTimeout(150);
      check(`${tag}: match length chosen directly`, (await page.locator(".rangeval").innerText()) === (act === "BY BIKE" ? "40 min" : "25 min"));
    }
    await startFromSetup(o, mode);
    const v0 = await view(page);
    check(`${tag}: match running with Easy`, !!v0.match && !v0.match.paused, JSON.stringify(v0));
    const diff = await page.locator(".pill.mode").innerText();
    check(`${tag}: the chosen difficulty is the one played`, /EASY/i.test(diff), diff);
    const trip = await page.locator(".pill.tripstats").evaluate((g) => ({ cells: [...g.querySelectorAll(".cell")].map((c) => c.getAttribute("aria-label")), icon: g.querySelectorAll(".tripicon svg").length }));
    const bike = act === "BY BIKE";
    check(`${tag}: trip field shows ${bike ? "speed, " : ""}distance and time`, trip.icon === 1 && trip.cells.length === (bike ? 3 : 2) && trip.cells.some((c) => /^Distance /.test(c)) && trip.cells.some((c) => /^Elapsed /.test(c)), JSON.stringify(trip));
    const bx = await boxes(page);
    const hit = bx.others.filter((b) => overlaps(bx.trip, b));
    check(`${tag}: trip field on the left, inside the screen, overlapping nothing`, bx.trip.l <= 16 && bx.trip.r <= bx.vw && hit.length === 0, JSON.stringify({ trip: bx.trip, hit }));
    check(`${tag}: no sideways scrolling in the game`, !(await hscroll(page)));
    await shot(page, `play-${bike ? "bike" : "foot"}-${mode.replace(/ /g, "")}`);
    if (mode === "CHECKPOINTS") {
      // Distance follows the movement the game registers; time follows the game clock.
      await page.evaluate(() => { window.__outbreak.live.state.zombies = []; window.__outbreak.live.rules.maxZombies = 0; });
      const before = await view(page);
      await o.walk(12);
      await o.wait(800);
      const after = await view(page);
      const shown = await page.locator(".pill.tripstats .cell").evaluateAll((cs) => cs.map((c) => c.getAttribute("aria-label")));
      check(`${tag}: distance grows with the registered movement (not zero, not more than walked)`, after.match.distanceM > before.match.distanceM + 10 && after.match.distanceM < 40, `${before.match.distanceM.toFixed(1)} → ${after.match.distanceM.toFixed(1)} m`);
      check(`${tag}: time grows with the game clock`, after.match.elapsedS >= before.match.elapsedS + 10, `${before.match.elapsedS.toFixed(1)} → ${after.match.elapsedS.toFixed(1)} s`);
      check(`${tag}: the field shows the session's numbers`, shown.some((x) => x === `Distance ${(after.match.distanceM / 1000).toFixed(1)} km` || /^Distance \d/.test(x)), shown.join(" | "));
      // Pause: the clock stands still.
      await page.getByRole("button", { name: "PAUSE" }).click();
      const p1 = (await view(page)).match.elapsedS; await o.wait(2400); const p2 = (await view(page)).match.elapsedS;
      check(`${tag}: paused, the time stands still`, Math.abs(p2 - p1) < 0.3, `${p1} → ${p2}`);
      await page.getByRole("dialog").getByRole("button", { name: "CONTINUE" }).click(); await o.wait(800);
    }
    // QUIT → KEEP PLAYING: the same match goes on.
    const id = (await view(page)).match.id;
    await page.locator(".controls .iconbtn").click(); await page.getByRole("dialog", { name: "Paused" }).getByRole("button", { name: "QUIT" }).click();
    const qd = page.getByRole("dialog", { name: "Quit the match?" });
    await qd.waitFor();
    check(`${tag}: QUIT asks once, with exactly KEEP PLAYING and QUIT`, (await qd.getByRole("button").count()) === 2 && (await qd.getByRole("button", { name: "KEEP PLAYING" }).count()) === 1 && (await qd.getByRole("button", { name: "QUIT", exact: true }).count()) === 1);
    const e1 = (await view(page)).match.elapsedS;
    await qd.getByRole("button", { name: "KEEP PLAYING" }).click(); await o.wait(2000);
    const kv = await view(page);
    check(`${tag}: KEEP PLAYING keeps the match running`, kv.match?.id === id && !kv.match.paused && kv.match.phase !== "finished" && kv.match.elapsedS > e1 + 1 && (await page.getByRole("dialog").count()) === 0, JSON.stringify(kv.match));
    if (mode === "SURVIVAL") {
      // QUIT → QUIT: straight to the start page, nothing of the match left, and a new match starts clean.
      await page.locator(".controls .iconbtn").click(); await page.getByRole("dialog", { name: "Paused" }).getByRole("button", { name: "QUIT" }).click();
      await page.getByRole("dialog", { name: "Quit the match?" }).getByRole("button", { name: "QUIT", exact: true }).click();
      let sawResult = false;
      for (let i = 0; i < 20 && new URL(page.url()).pathname !== "/"; i++) { if (await page.locator(".resultbg, .scare, .modal-backdrop").count()) sawResult = true; await page.waitForTimeout(100); }
      await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 15000 });
      const after = await view(page);
      const audio = await page.evaluate(() => { const a = window.__outbreakAudio; return a ? { voices: a.soundscape.voiceCount, ...a.match.state } : null; });
      check(`${tag}: QUIT goes straight to the start page with no result, scare or second question`, !sawResult && (await page.getByRole("dialog").count()) === 0 && (await page.getByRole("heading", { name: "OUTBREAK" }).isVisible()));
      check(`${tag}: after QUIT the session holds no match and no sound is left`, after.match === null && after.stage !== "finished" && (!audio || (audio.voices === 0 && audio.threat === null && !audio.heliLoop)), JSON.stringify({ after, audio }));
      o.home();
      await toSetup(o, act, "SURVIVAL");
      await startFromSetup(o, "SURVIVAL");
      const fresh = await view(page);
      check(`${tag}: a new match after QUIT starts from zero`, !!fresh.match && fresh.match.id !== id && fresh.match.distanceM < 1 && fresh.match.elapsedS < 6, JSON.stringify(fresh.match));
    }
    await o.ctx.close();
  }
}

// --- Narrow phone: the bike field still fits ---
{
  const o = await open({ width: 320, height: 568 });
  await toSetup(o, "BY BIKE", "SURVIVAL");
  check("320 px setup: no sideways scrolling", !(await hscroll(o.page)));
  await startFromSetup(o, "SURVIVAL");
  const bx = await boxes(o.page);
  check("320 px Bike: trip field on the left, overlapping nothing", bx.trip.l <= 16 && bx.trip.r <= bx.vw && bx.others.every((b) => !overlaps(bx.trip, b)), JSON.stringify(bx.trip));
  check("320 px game: no sideways scrolling", !(await hscroll(o.page)));
  await shot(o.page, "play-bike-320");
  await o.ctx.close();
}

const real = errors.filter((e) => !/Failed to load resource|favicon|WebGL|swiftshader|GPU stall|tiles\.openfreemap/i.test(e));
check("no page errors", real.length === 0, real.slice(0, 3).join(" | "));
await browser.close();
console.log(`${res.filter(Boolean).length}/${res.length} passed`);
process.exit(res.every(Boolean) ? 0 : 1);
