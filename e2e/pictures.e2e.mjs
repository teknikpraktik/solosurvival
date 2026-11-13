// Mood and result pictures: start page, Survival helicopter cards, the picture behind each ending, missing and slow pictures.
// GPS is MOCKED, and match time and endings are FORCED through the debug handle (window.__outbreak): simulated checks, not a field test.
// BASE_URL=http://localhost:3100 CHROMIUM_PATH=… [SHOTS=dir] node e2e/pictures.e2e.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
async function open(vp = { width: 390, height: 844 }, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START, ...opts });
  await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); localStorage.setItem("outbreak.cues", "off"); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  /** Waits while sending a fresh fix every 400 ms, as a phone would. */
  const wait = async (ms) => { for (let t = 0; t < ms; t += 400) { await ctx.setGeolocation(START); await page.waitForTimeout(400); } };
  return { ctx, page, wait };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
async function startMatch({ page, wait }, act, mode) {
  await page.goto(BASE + "/new"); await wait(1200);
  await page.getByRole("button", { name: act, exact: true }).click();
  await page.getByRole("button", { name: mode, exact: true }).click(); await wait(800);
  if (mode !== "SURVIVAL") await page.locator(".pvstats").waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: "START GAME" }).click();
  await page.waitForURL("**/play", { timeout: 90000 });
  for (let i = 0; i < 40 && !(await page.evaluate(() => { const m = window.__outbreak?.getView().match; return !!m && !m.paused; })); i++) await wait(400);
}
/** Moves the game clock to `before` seconds before extraction opens and clears the zombies (the test is about the helicopter). */
const toExtraction = (page, before) => page.evaluate((b) => { const l = window.__outbreak.live; l.state.zombies = []; l.state.elapsedSeconds = l.rules.extractionOpensAtS - b; }, before);
/** Ends the match with this result through the session's own end handling. */
const forceEnd = (page, result) => page.evaluate((r) => { const s = window.__outbreak; s.live.state.phase = "finished"; s.live.state.result = r; s.endMatch([{ type: "finished", result: r }]); }, result);
const card = (page) => page.locator(".helicard");
const resultImg = (page) => page.evaluate(() => { const bg = document.querySelector(".resultbg"); const img = bg?.querySelector("img"); return bg ? { pic: bg.getAttribute("data-pic"), src: img?.getAttribute("src") ?? null, loaded: !!img && img.complete && img.naturalWidth > 0 } : null; });
const dialogBox = (page) => page.evaluate(() => { const d = document.querySelector(".modal"); if (!d) return null; const r = d.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });

// --- Start page ---
{
  const o = await open();
  await o.page.goto(BASE + "/"); await o.page.waitForTimeout(1500);
  const bg = await o.page.locator(".hero").evaluate((e) => getComputedStyle(e).backgroundImage);
  check("start page: hero-v2.jpg behind the title, hero.svg as fallback, old photo gone", bg.includes("/img/hero-v2.jpg") && bg.includes("/img/hero.svg") && !bg.includes("/img/hero.jpg"), bg.slice(0, 160));
  check("start page: title and buttons visible", (await o.page.getByRole("heading", { name: "OUTBREAK" }).isVisible()) && (await o.page.getByRole("link", { name: "NEW GAME" }).isVisible()));
  await shot(o.page, "01-start");
  await o.ctx.close();
}

// --- Survival on foot: approaching once, landed, end removes the card, extracted picture ---
{
  const o = await open(); const { page, wait } = o;
  await startMatch(o, "ON FOOT", "SURVIVAL");
  check("Survival: no helicopter card at the start", (await card(page).count()) === 0);
  const seen = [];
  const watch = async (ms) => { for (let t = 0; t < ms; t += 250) { seen.push(await page.evaluate(() => document.querySelector(".helicard")?.getAttribute("data-kind") ?? "-")); await o.ctx.setGeolocation(START); await page.waitForTimeout(250); } };
  await toExtraction(page, 61.5);
  await watch(2500);
  const c = card(page);
  const shown = (await c.count()) === 1 && (await c.getAttribute("data-kind")) === "approaching";
  const txt = shown ? await c.innerText() : "";
  check("approaching card: about 60 s before extraction, with its status text", shown && /HELICOPTER INBOUND/.test(txt) && /Extraction opens in [01]:\d\d/.test(txt), txt.replace(/\n/g, " / "));
  const layout = await page.evaluate(() => {
    const cd = document.querySelector(".helicard").getBoundingClientRect(), ctl = document.querySelector(".controls").getBoundingClientRect(), hud = document.querySelector(".hudbar").getBoundingClientRect();
    const auto = document.querySelector(".autobtn").getBoundingClientRect();
    const hit = document.elementFromPoint(auto.left + auto.width / 2, auto.top + auto.height / 2);
    return { pe: getComputedStyle(document.querySelector(".helicard")).pointerEvents, aboveControls: cd.bottom <= ctl.top, belowHud: cd.top > hud.bottom, below60: cd.top > innerHeight * 0.6, autoHit: hit?.classList.contains("autobtn") ?? false, anim: getComputedStyle(document.querySelector(".helicard")).animationName };
  });
  check("the card lets touches through, sits above the controls and below the player (60 %), clear of the HUD", layout.pe === "none" && layout.aboveControls && layout.belowHud && layout.below60 && layout.autoHit, JSON.stringify(layout));
  check("no shake or flash: only a short fade-in", layout.anim === "helicard-in");
  check("the HUD keeps the helicopter countdown while the card shows", (await page.locator(".pill.goal.heli").count()) === 1);
  await shot(page, "02-heli-approaching");
  await watch(3500);
  check("the card goes by itself after about 3 s, no tap needed", (await card(page).count()) === 0 && (await page.locator(".pill.goal.heli").count()) === 1);
  await toExtraction(page, 1.2);
  await watch(2000);
  const landed = (await card(page).count()) === 1 && (await card(page).getAttribute("data-kind")) === "landed";
  check("landed card when extraction opens; the HUD says Extraction open", landed && /HELICOPTER LANDED/.test(await card(page).innerText()) && /Extraction open/.test(await page.locator(".hudbar").innerText()));
  const thumb = await page.evaluate(() => ({ icon: !!document.querySelector(".helicard-icon svg"), text: document.querySelector(".helicard-text")?.textContent ?? "" }));
  check("landed picture missing: the card still has its helicopter icon and text", thumb.icon && thumb.text.length > 10);
  await shot(page, "03-heli-landed-fallback");
  const kinds = seen.filter((k, i) => k !== "-" && k !== seen[i - 1]);
  check("approaching shown once, then landed (never approaching again)", kinds.length === 2 && kinds[0] === "approaching" && kinds[1] === "landed", kinds.join(","));
  await forceEnd(page, "survived");
  await page.waitForTimeout(150);
  check("match end removes the card at once", (await card(page).count()) === 0);
  await page.locator(".modal").waitFor({ timeout: 10000 }); await wait(1500);
  const r = await resultImg(page);
  check("Survival won: extracted.jpg behind the result", r?.pic === "extracted" && r.src === "/img/extracted.jpg" && r.loaded, JSON.stringify(r));
  const d = await dialogBox(page);
  check("the result dialog sits low, the picture's subject above it", d && d.bottom >= d.vh - 20 && d.top > d.vh * 0.3, JSON.stringify(d));
  check("results, numbers and buttons kept", /EXTRACTED/.test(await page.locator(".modal").innerText()) && (await page.locator(".modal .statcells dd").count()) === 3 && (await page.getByRole("button", { name: /Play again/i }).count()) === 1);
  await shot(page, "04-result-extracted");
  await o.ctx.close();
}

// --- Bike: the cards show on the bike too; out of time (picture missing): the result still shows ---
{
  const o = await open(); const { page, wait } = o;
  await startMatch(o, "BY BIKE", "SURVIVAL");
  await toExtraction(page, 61.5); await wait(2500);
  check("bike: approaching card shown too", (await card(page).count()) === 1 && (await card(page).getAttribute("data-kind")) === "approaching");
  await shot(page, "05-bike-approaching");
  await forceEnd(page, "failed");
  await page.locator(".modal").waitFor({ timeout: 10000 }); await wait(1500);
  const r = await resultImg(page);
  check("out of time: out-of-time picture asked for; if the file is missing the dark background stays (no broken image)", r?.pic === "out-of-time" && (r.src === null || r.loaded), JSON.stringify(r));
  check("out of time: OUT OF TIME, numbers and buttons", /OUT OF TIME/.test(await page.locator(".modal").innerText()) && (await page.locator(".modal .statcells dd").count()) === 3);
  await shot(page, "06-result-out-of-time");
  await o.ctx.close();
}

// --- Captured: the scare uses captured-v2.jpg, then the same picture behind the result ---
{
  const o = await open(); const { page, wait } = o;
  await startMatch(o, "ON FOOT", "SURVIVAL");
  await forceEnd(page, "infected");
  await page.locator(".scare").waitFor({ timeout: 5000 });
  const scareSrc = await page.locator(".scare img").getAttribute("src");
  check("captured: the full-screen scare (unchanged behaviour) shows captured-v2.jpg", scareSrc === "/img/captured-v2.jpg", scareSrc);
  await page.waitForTimeout(600); await shot(page, "07-scare");
  await page.locator(".modal").waitFor({ timeout: 10000 }); await wait(800);
  const r = await resultImg(page);
  check("captured: captured-v2.jpg behind the result", r?.pic === "captured" && r.src === "/img/captured-v2.jpg" && r.loaded, JSON.stringify(r));
  await shot(page, "08-result-captured");
  await o.ctx.close();
}

// --- Checkpoints won: the safe house; no helicopter cards in Checkpoints ---
{
  const o = await open(); const { page, wait } = o;
  await startMatch(o, "ON FOOT", "CHECKPOINTS");
  // Checkpoints has no extraction: move the clock well into the match instead.
  await page.evaluate(() => { const l = window.__outbreak.live; l.state.zombies = []; l.state.elapsedSeconds = 1500; }); await wait(2000);
  check("Checkpoints: no helicopter cards", (await card(page).count()) === 0);
  await forceEnd(page, "survived");
  await page.locator(".modal").waitFor({ timeout: 10000 }); await wait(1500);
  const r = await resultImg(page);
  check("Checkpoints won: safehouse.jpg behind COURSE COMPLETE", r?.pic === "safehouse" && r.src === "/img/safehouse.jpg" && r.loaded && /COURSE COMPLETE/.test(await page.locator(".modal").innerText()), JSON.stringify(r));
  await shot(page, "09-result-safehouse");
  await o.ctx.close();
}

// --- Slow picture: the result does not wait for it ---
{
  const o = await open(); const { page, wait } = o;
  await o.ctx.route("**/img/extracted.jpg", async (route) => { await new Promise((r) => setTimeout(r, 6000)); await route.continue(); });
  await startMatch(o, "ON FOOT", "SURVIVAL");
  await forceEnd(page, "survived");
  const t0 = Date.now();
  await page.locator(".modal").waitFor({ timeout: 10000 });
  check("slow picture: the result dialog shows at once (within 2 s)", Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
  await wait(400);
  await o.ctx.close();
}

// --- Missing match pictures: start, card and result still work ---
{
  const o = await open();
  await o.ctx.route(/\/img\/(heli-approaching|extracted|safehouse|captured-v2|out-of-time|heli-landed)\.jpg/, (r) => r.fulfill({ status: 404, body: "" }));
  const { page, wait } = o;
  await startMatch(o, "ON FOOT", "SURVIVAL");
  check("pictures missing: the match starts", await page.evaluate(() => window.__outbreak.getView().stage === "playing"));
  await toExtraction(page, 61.5); await wait(2500);
  check("pictures missing: the approaching card shows with icon and text", (await card(page).count()) === 1 && (await page.locator(".helicard-icon svg").count()) === 1);
  await forceEnd(page, "survived");
  await page.locator(".modal").waitFor({ timeout: 10000 }); await wait(800);
  const r = await resultImg(page);
  check("pictures missing: the result shows on the dark background, no broken image", r?.pic === "extracted" && r.src === null && /EXTRACTED/.test(await page.locator(".modal").innerText()), JSON.stringify(r));
  await o.ctx.close();
}

// --- Small phone and reduced motion ---
{
  const o = await open({ width: 320, height: 568 }, { reducedMotion: "reduce" }); const { page, wait } = o;
  await startMatch(o, "ON FOOT", "SURVIVAL");
  await toExtraction(page, 61.5); await wait(2500);
  const l = await page.evaluate(() => { const cd = document.querySelector(".helicard")?.getBoundingClientRect(), ctl = document.querySelector(".controls").getBoundingClientRect(); return cd ? { inside: cd.left >= 0 && cd.right <= innerWidth && cd.top >= 0, aboveControls: cd.bottom <= ctl.top, below60: cd.top > innerHeight * 0.6, anim: getComputedStyle(document.querySelector(".helicard")).animationName, textCut: [...document.querySelectorAll(".helicard-text > *")].some((e) => e.scrollWidth > e.clientWidth + 1) } : null; });
  check("320×568: the card fits, above the controls and below the player; no animation with reduced motion", l && l.inside && l.aboveControls && l.below60 && l.anim === "none" && !l.textCut, JSON.stringify(l));
  await shot(page, "10-small-approaching");
  await forceEnd(page, "survived");
  await page.locator(".modal").waitFor({ timeout: 10000 }); await wait(1000);
  const d = await dialogBox(page);
  const btn = await page.getByRole("button", { name: /Play again/i }).boundingBox();
  check("320×568: the whole result dialog and its buttons are on screen", d && d.top >= 0 && d.bottom <= d.vh && btn && btn.y + btn.height <= 568, JSON.stringify(d));
  await shot(page, "11-small-result");
  await o.ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
const failed = res.filter((x) => !x).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
