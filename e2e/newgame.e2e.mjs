// NEW GAME in three steps (activity → mode → setup on the map), the shortcut for returning players and the in-game sound button.
// GPS is MOCKED (Playwright), map data is the bundled extract: simulated checks, not a field test.
// Run against a dev or production server: BASE_URL=http://localhost:3100 CHROMIUM_PATH=… node e2e/newgame.e2e.mjs
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const newCtx = async (vp = { width: 390, height: 844 }, opts = {}) => {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START, ...opts });
  await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
  return ctx;
};
const fixes = async (ctx, page, n = 4) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(250); } };
const step = (page) => new URL(page.url()).searchParams.get("step") ?? "activity";
const card = (page, name) => page.locator(".imgcard", { has: page.locator(".imgcard-title", { hasText: new RegExp(`^${name}`) }) });
const sessionStage = (page) => page.evaluate(() => window.__outbreak?.getView().stage);
const startBtn = (page) => page.getByRole("button", { name: /^(START GAME|LOADING MAP…)$/ });
const errors = [];
const watch = (page) => { page.on("pageerror", (e) => errors.push(e.message)); };

// --- Steps, cards and navigation ---
{
  const ctx = await newCtx();
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + "/new"); await page.waitForTimeout(1500);
  check("step 1: two picture cards named ON FOOT and BY BIKE (title only; subtitle as description; the earlier choice aria-current)", (await page.locator(".imgcards.two .imgcard").count()) === 2 && (await page.getByRole("button", { name: "ON FOOT", exact: true }).count()) === 1 && (await page.getByRole("button", { name: "BY BIKE", exact: true }).count()) === 1 && (await page.getByRole("button", { name: "ON FOOT", exact: true }).getAttribute("aria-current")) === "true");
  check("step 1: no shortcut for a new player", (await page.locator(".lastsetup").count()) === 0);
  check("step 1: no Next button", (await page.getByRole("button", { name: /NEXT/i }).count()) === 0);
  check("step 1: the pictures are CSS backgrounds (no <img>, nothing read twice)", (await page.locator(".imgcard img").count()) === 0 && (await page.locator(".imgcard-bg[aria-hidden=true]").count()) === 2);
  const bg = await page.locator('.imgcard[data-card="foot"] .imgcard-bg').evaluate((e) => getComputedStyle(e).backgroundImage);
  check("step 1: ON FOOT shows card-foot.jpg", bg.includes("/img/card-foot.jpg"), bg);
  await card(page, "BY BIKE").click(); await page.waitForTimeout(400);
  check("one tap on a card moves on to the mode step", step(page) === "mode" && (await page.locator(".imgcards.three .imgcard").count()) === 3);
  const subs = await page.locator(".imgcard-sub").allInnerTexts();
  check("step 2: every mode card explains how you win", subs.length === 3 && subs.every((s) => /time runs out/.test(s)), subs.join(" | "));
  check("step 2: shows the chosen activity", (await page.locator(".ngprompt").innerText()).toUpperCase().includes("BIKE"));
  await page.goBack(); await page.waitForTimeout(400);
  check("browser back: mode → activity, BY BIKE still marked as the choice", step(page) === "activity" && (await card(page, "BY BIKE").getAttribute("data-current")) !== null);
  await page.goForward(); await page.waitForTimeout(400);
  check("browser forward: back on the mode step", step(page) === "mode");
  await page.getByRole("button", { name: "Back to activity" }).click(); await page.waitForTimeout(400);
  check("the header's back button: mode → activity", step(page) === "activity");
  // Keyboard: focus a card and press Enter.
  for (let i = 0; i < 8 && !(await page.evaluate(() => document.activeElement?.classList.contains("imgcard"))); i++) await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => (document.activeElement?.classList.contains("imgcard") ? getComputedStyle(document.activeElement).outlineStyle : "not focused"));
  check("keyboard focus is visible on a card", ring !== "none", ring);
  await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  check("Enter on a focused card chooses it", step(page) === "mode");
  await ctx.close();
}

// --- All six combinations of activity and mode on the setup step ---
for (const act of ["ON FOOT", "BY BIKE"]) {
  for (const mode of ["CHECKPOINTS", "A TO B", "SURVIVAL"]) {
    const ctx = await newCtx();
    const page = await ctx.newPage(); watch(page);
    await page.goto(BASE + "/new"); await page.waitForTimeout(1200);
    await fixes(ctx, page);
    await card(page, act).click(); await page.waitForTimeout(300);
    await card(page, mode).click(); await page.waitForTimeout(500);
    const tag = `${act} · ${mode}`;
    const chips = await page.locator(".ngchip").allInnerTexts();
    const chipOk = chips.length === 2 && chips[0].toUpperCase().includes(act === "ON FOOT" ? "ON FOOT" : "BIKE") && chips[1].toUpperCase().includes(mode);
    const settingOk = mode === "CHECKPOINTS" ? (await page.locator("#dist").count()) === 1 : mode === "SURVIVAL" ? (await page.locator("#dur").count()) === 1 : (await page.locator(".ngrange").count()) === 0;
    check(`${tag}: setup shows the choices as buttons and only the settings this mode uses`, step(page) === "setup" && chipOk && settingOk && (await page.getByRole("group", { name: "Difficulty" }).count()) === 1, chips.join("/"));
    if (mode === "CHECKPOINTS") {
      const shown = await page.locator(".pvstats").waitFor({ timeout: 90000 }).then(() => true, () => false);
      check(`${tag}: the course is planned on the setup step, numbered checkpoints on the map, START GAME enabled`, shown && (await page.locator('[aria-label^="Objective"]').count()) >= 2 && (await startBtn(page).isEnabled()), shown ? "" : await page.locator(".ngpanel").innerText());
      check(`${tag}: REGENERATE is there`, (await page.getByRole("button", { name: /Regenerate/ }).count()) === 1);
    } else if (mode === "A TO B") {
      check(`${tag}: START GAME is off until B is chosen`, await startBtn(page).isDisabled());
      await page.waitForSelector('[data-loaded="true"]', { timeout: 20000, state: "attached" }); await page.waitForTimeout(1500);
      let ok = false, info = "";
      for (const [x, y] of [[280, 220], [110, 200], [300, 320], [90, 330], [200, 150], [330, 260]]) {
        await fixes(ctx, page, 2);
        await page.mouse.click(x, y); await page.waitForTimeout(400);
        if ((await page.locator('[aria-label="Objective B"]').count()) === 0) continue;
        ok = await page.locator(".pvstats").waitFor({ timeout: 60000 }).then(() => true, () => false);
        if (ok && await startBtn(page).isEnabled()) break;
        info = await page.locator(".ngpanel").innerText(); ok = false;
      }
      check(`${tag}: tapping B on the map plans the route in the same view and enables START GAME`, ok, info.slice(0, 200));
    } else {
      check(`${tag}: no course to plan, the match facts are shown and START GAME is enabled`, ((await page.locator(".pvstats").textContent()) ?? "").includes("Extraction") && (await startBtn(page).isEnabled()));
      check(`${tag}: no REGENERATE`, (await page.getByRole("button", { name: /Regenerate/ }).count()) === 0);
    }
    const st = await sessionStage(page);
    check(`${tag}: no match is running before START GAME`, st !== "playing", String(st));
    // START near the bottom, inside the screen.
    const b = await startBtn(page).boundingBox();
    check(`${tag}: START GAME near the bottom and fully on screen`, !!b && b.y + b.height <= 844 && b.y > 844 * 0.7, JSON.stringify(b));
    await ctx.close();
  }
}

// --- Changed choices, late answers and back on the setup step ---
{
  const ctx = await newCtx();
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + "/new"); await page.waitForTimeout(1200);
  await fixes(ctx, page);
  await card(page, "ON FOOT").click(); await page.waitForTimeout(300);
  await card(page, "CHECKPOINTS").click();
  await page.locator(".pvstats").waitFor({ timeout: 90000 });
  // Change the distance: the old course must not be startable while the new one is being planned.
  await page.locator("#dist").fill("4000");
  await page.waitForTimeout(50);
  check("distance changed: the old course is not startable while the new one is planned", await startBtn(page).isDisabled());
  await page.waitForFunction(() => window.__outbreak?.getView().params?.targetLengthM === 4000 && window.__outbreak.getView().stage === "preview", null, { timeout: 90000 });
  await page.waitForTimeout(300);
  check("…then the new course is shown and startable", (await startBtn(page).isEnabled()) && (await page.locator(".rangeval").innerText()) === "4.0 km");
  // Difficulty changes no course.
  const before = await page.evaluate(() => JSON.stringify(window.__outbreak.getView().prepared.proposals[0].waypoints));
  await page.getByRole("button", { name: "Hard", exact: true }).click(); await page.waitForTimeout(800);
  const after = await page.evaluate(() => JSON.stringify(window.__outbreak.getView().prepared.proposals[0].waypoints));
  check("difficulty changes no course (same checkpoints) and START stays enabled", before === after && (await startBtn(page).isEnabled()));
  // Back to the mode step with the UI back button, then the browser.
  await page.getByRole("button", { name: "Back to game mode" }).click(); await page.waitForTimeout(400);
  check("setup → back button → mode step, the choice kept", step(page) === "mode" && (await card(page, "CHECKPOINTS").getAttribute("data-current")) !== null);
  await page.goForward(); await page.waitForTimeout(600);
  const fwd = { step: step(page), dist: await page.locator(".rangeval").textContent().catch(() => null), hard: await page.locator('.ngsettings .opt[aria-pressed="true"]').textContent().catch(() => null) };
  check("browser forward → setup again with the same settings and course", fwd.step === "setup" && fwd.dist === "4.0 km" && fwd.hard === "Hard", JSON.stringify(fwd));
  // Another mode drops the course; a slow answer for the old one must not come back.
  await page.getByRole("button", { name: /^Game mode: CHECKPOINTS/ }).click(); await page.waitForTimeout(300);
  await card(page, "SURVIVAL").click(); await page.waitForTimeout(800);
  const v = await page.evaluate(() => ({ stage: window.__outbreak.getView().stage, prepared: !!window.__outbreak.getView().prepared }));
  check("switching to SURVIVAL drops the Checkpoints course (nothing prepared, no course markers)", !v.prepared && (await page.locator('[aria-label^="Objective"]').count()) === 0, JSON.stringify(v));
  // Changing the activity from the setup step resets the slider to the activity's defaults.
  await page.getByRole("button", { name: /^Activity: On foot/ }).click(); await page.waitForTimeout(300);
  check("the activity button on the setup step opens step 1", step(page) === "activity");
  await card(page, "BY BIKE").click(); await page.waitForTimeout(300);
  check("…and the mode step comes next (mode kept as current)", step(page) === "mode" && (await card(page, "SURVIVAL").getAttribute("data-current")) !== null);
  await card(page, "SURVIVAL").click(); await page.waitForTimeout(400);
  check("bike Survival: match length back to the bike default (45 min)", (await page.locator(".rangeval").innerText()) === "45 min", await page.locator(".rangeval").innerText());
  // A Checkpoints request immediately followed by a change: the late answer is discarded.
  await page.getByRole("button", { name: /^Game mode/ }).click(); await page.waitForTimeout(300);
  await card(page, "CHECKPOINTS").click(); await page.waitForTimeout(100);
  await page.getByRole("button", { name: /^Game mode/ }).click(); await page.waitForTimeout(100);
  await card(page, "A TO B").click();
  await page.waitForTimeout(8000);
  const v2 = await page.evaluate(() => ({ prepared: !!window.__outbreak.getView().prepared, mode: window.__outbreak.getView().params?.mode }));
  check("a course asked for and then abandoned does not appear in A TO B", !v2.prepared && (await page.locator('[aria-label^="Objective"]').count()) <= 1 && (await startBtn(page).isDisabled()), JSON.stringify(v2));
  await ctx.close();
}

// --- Loading and error states ---
{
  // No usable location yet: Checkpoints waits, START GAME off.
  const ctx = await newCtx({ width: 390, height: 844 }, { geolocation: { ...START, accuracy: 120 } });
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + "/new"); await page.waitForTimeout(1200);
  await card(page, "ON FOOT").click(); await card(page, "CHECKPOINTS").click(); await page.waitForTimeout(1500);
  check("poor location: a short note, waiting text, START GAME off", (await page.locator(".ngpanel .card.warn").count()) >= 1 && (await page.getByText(/Waiting for your location/).count()) === 1 && (await startBtn(page).isDisabled()));
  await ctx.close();
}
{
  // B where no route can be planned (far away, outside the bike network): the planner's message is shown and START stays off.
  const ctx = await newCtx();
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + "/new"); await page.waitForTimeout(1200);
  await fixes(ctx, page);
  await card(page, "BY BIKE").click(); await card(page, "A TO B").click(); await page.waitForTimeout(1500);
  await page.waitForSelector('[data-loaded="true"]', { timeout: 20000, state: "attached" });
  // Zoom far out and tap far away (beyond the 20 km limit).
  await page.evaluate(() => { const m = document.querySelector(".maplibregl-map"); m?.dispatchEvent(new Event("noop")); });
  for (let i = 0; i < 4; i++) { await page.mouse.move(195, 250); await page.mouse.wheel(0, 1200); await page.waitForTimeout(300); }
  await page.mouse.click(30, 120); await page.waitForTimeout(500);
  const bad = await page.locator(".ngpanel .card.bad").waitFor({ timeout: 60000 }).then(() => true, () => false);
  check("B where no route can be planned: the planner's reason is shown and START GAME stays off", bad && (await startBtn(page).isDisabled()), bad ? await page.locator(".ngpanel .card.bad").innerText() : await page.locator(".ngpanel").innerText());
  await ctx.close();
}

// --- Missing pictures ---
{
  const ctx = await newCtx();
  await ctx.route("**/img/card-*.jpg", (r) => r.fulfill({ status: 404, body: "" }));
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + "/new"); await page.waitForTimeout(1200);
  const boxes = await page.locator(".imgcard").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check("missing pictures: cards keep their size and text, no broken-image icon", boxes.length === 2 && boxes.every((h) => h >= 130) && (await page.locator("img").count()) === 0 && (await page.getByText("ON FOOT").isVisible()));
  await page.screenshot({ path: "/tmp/newgame-missing.png" });
  await ctx.close();
}

// --- Returning player: the shortcut opens the setup with the last choices, never a match ---
{
  const ctx = await newCtx();
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + "/new"); await page.waitForTimeout(1200);
  await fixes(ctx, page);
  await card(page, "BY BIKE").click(); await card(page, "SURVIVAL").click(); await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Easy", exact: true }).click();
  await page.locator("#dur").fill("45"); await page.waitForTimeout(200);
  await fixes(ctx, page, 2);
  await startBtn(page).click();
  await page.waitForURL("**/play", { timeout: 90000 }); await page.waitForTimeout(800);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("outbreak.newgame.last") ?? "null"));
  check("a started match keeps its choices (no position, B or seed)", kept && kept.activity === "mtb" && kept.mode === "survival" && kept.difficulty === "easy" && kept.durationS === 2700 && !("pointB" in kept) && !("seed" in kept), JSON.stringify(kept));
  // Abort the match and come back to New game.
  await page.evaluate(() => window.__outbreak?.abort?.());
  await page.goto(BASE + "/new"); await page.waitForTimeout(1500);
  const last = page.locator(".lastsetup");
  check("step 1 offers the shortcut with the last choices", (await last.count()) === 1 && /Bike · SURVIVAL · Easy/.test(await last.innerText()), await last.innerText().catch(() => ""));
  check("the picture cards are still there below it", (await page.locator(".imgcards.two .imgcard").count()) === 2);
  await last.click(); await page.waitForTimeout(800);
  const st = await sessionStage(page);
  check("the shortcut opens the setup step with the saved settings, and no match starts", step(page) === "setup" && (await page.locator(".rangeval").innerText()) === "45 min" && (await page.getByRole("button", { name: "Easy", exact: true }).getAttribute("aria-pressed")) === "true" && st !== "playing" && page.url().includes("/new"), String(st));
  await page.getByRole("button", { name: "Back to game mode" }).click(); await page.waitForTimeout(400);
  check("back from a setup opened by the shortcut goes to the mode step", step(page) === "mode");
  // Broken saved data: no shortcut, defaults.
  await page.evaluate(() => localStorage.setItem("outbreak.newgame.last", "{broken"));
  await page.goto(BASE + "/new"); await page.waitForTimeout(1200);
  check("unreadable saved setup: no shortcut, the flow works with the defaults", (await page.locator(".lastsetup").count()) === 0 && (await card(page, "ON FOOT").getAttribute("data-current")) !== null);
  await ctx.close();
}

// --- Small phones: the setup panel can be made small so the map gets room ---
{
  const ctx = await newCtx({ width: 320, height: 568 });
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + "/new"); await page.waitForTimeout(1200);
  const fit = await page.evaluate(() => [...document.querySelectorAll(".imgcard")].every((e) => e.getBoundingClientRect().bottom <= innerHeight + 1));
  check("320×568: both activity cards fit without scrolling", fit);
  await fixes(ctx, page);
  await card(page, "ON FOOT").click(); await page.waitForTimeout(300);
  const fit3 = await page.evaluate(() => ({ bottom: Math.max(...[...document.querySelectorAll(".imgcard")].map((e) => e.getBoundingClientRect().bottom)), h: innerHeight }));
  check("320×568: the three mode cards are reachable (at most a short scroll)", fit3.bottom <= fit3.h + 140, JSON.stringify(fit3));
  await card(page, "CHECKPOINTS").click();
  await page.locator(".pvstats").waitFor({ timeout: 90000 });
  check("short screen: the settings start hidden so the map gets room", (await page.locator(".pvtoggle").getAttribute("aria-expanded")) === "false" && !(await page.locator("#ngsettings").isVisible()));
  const closed = await page.locator(".ngpanel").boundingBox();
  await page.locator(".pvtoggle").click(); await page.waitForTimeout(400);
  const open = await page.locator(".ngpanel").boundingBox();
  check("the settings toggle opens them (difficulty and distance reachable)", open.height > closed.height + 60 && (await page.getByRole("group", { name: "Difficulty" }).isVisible()) && (await page.locator("#dist").isVisible()), `${closed.height} → ${open.height}`);
  await page.locator(".pvtoggle").click(); await page.waitForTimeout(400);
  check("…and hides them again; START GAME stays", (await page.locator(".pvtoggle").getAttribute("aria-expanded")) === "false" && (await startBtn(page).isVisible()));
  const ms = await page.evaluate(() => { const top = document.querySelector(".pvtop").getBoundingClientRect().bottom, bottom = document.querySelector(".ngpanel").getBoundingClientRect().top; return [...document.querySelectorAll('[aria-label^="Objective"], .goalmark.home')].filter((e) => { const r = e.getBoundingClientRect(); const y = r.top + r.height / 2; return y < top || y > bottom; }).length; });
  check("320×568 with the settings hidden: every course marker in the visible map", ms === 0, `${ms} hidden`);
  const small = await page.evaluate(() => [...document.querySelectorAll(".backbtn, .pvtoggle, .pvactions .btn")].filter((e) => { const b = e.getBoundingClientRect(); return b.height < 44 || b.width < 44; }).length);
  check("all setup buttons at least 44×44 px", small === 0);
  await page.reload(); await page.waitForTimeout(1500);
  check("after a reload the setup step comes back with the settings hidden as left", step(page) === "setup" && (await page.locator(".pvtoggle").getAttribute("aria-expanded")) === "false");
  await ctx.close();
}

// --- Sound: on by default, toggled in the game, kept after reload ---
async function startSurvival(page) {
  await page.goto(BASE + "/new"); await page.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) { await page.context().setGeolocation(START); await page.waitForTimeout(300); }
  await card(page, "ON FOOT").click(); await card(page, "SURVIVAL").click(); await page.waitForTimeout(400);
  for (let i = 0; i < 2; i++) { await page.context().setGeolocation(START); await page.waitForTimeout(300); }
  await startBtn(page).click();
  await page.waitForURL("**/play", { timeout: 90000 }); await page.waitForTimeout(1000);
}
const soundBtn = (page) => page.locator(".controls .iconbtn");
const pressed = (loc) => loc.getAttribute("aria-pressed").then((v) => v === "true");
{
  const ctx = await newCtx();
  const page = await ctx.newPage(); watch(page);
  await startSurvival(page);
  check("new player: sound on in the game", await pressed(soundBtn(page)));
  await soundBtn(page).click();
  check("tap: sound off (stored)", !(await pressed(soundBtn(page))) && (await page.evaluate(() => localStorage.getItem("outbreak.cues"))) === "off");
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
const failed = res.filter((x) => !x).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
