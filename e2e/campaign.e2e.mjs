// Campaign THE FALL in a phone-sized browser against a running server (npm run build && npx next start -p 3100):
//   BASE_URL=http://localhost:3100 node e2e/campaign.e2e.mjs
// The main menu, the campaign list, mission cards and locks, difficulty, intro and briefing, a won mission (unlocks the next), a failed
// mission (retry, nothing lost), and Free Play still reachable. GPS is MOCKED and the game clock is moved forward through the debug
// handle (window.__outbreak): this checks the flow and the layout, it is not a field test.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "e2e/out";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " – " + info : ""}`); };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  viewport: { width: Number(process.env.VW ?? 390), height: Number(process.env.VH ?? 844) }, deviceScaleFactor: Number(process.env.DSF ?? 1), isMobile: true, hasTouch: true,
  permissions: ["geolocation"], geolocation: START,
});
await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch { /* ignored */ } });
const page = await ctx.newPage();
const errors = [];
// Campaign voice files the page fetched, with their HTTP status.
const voices = new Map();
page.on("response", (r) => { const m = /\/campaign\/the-fall\/voice\/([^/?]+)\.mp3/.exec(r.url()); if (m) voices.set(m[1], r.status()); });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const gps = async (n = 3) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(350); } };
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const progress = () => page.evaluate(() => JSON.parse(localStorage.getItem("outbreak.campaign.the-fall") ?? "null"));
/** No horizontal overflow: nothing is wider than the phone. */
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Starts the mission whose briefing (or intro) is open, and waits for the game to run. */
async function startMission() {
  const skip = page.getByRole("button", { name: /SKIP/ });
  if (await skip.count()) await skip.click();
  await gps(3);
  const start = page.getByRole("button", { name: "START MISSION" });
  await start.waitFor({ timeout: 15000 });
  for (let i = 0; i < 20 && (await start.isDisabled()); i++) await gps(1);
  await start.click();
  await page.waitForURL("**/play", { timeout: 90000 });
  await page.waitForSelector('[data-testid="map"][data-loaded="true"]', { timeout: 30000 });
  for (let i = 0; i < 20; i++) {
    await gps(1);
    if (await page.evaluate(() => { const m = window.__outbreak?.getView().match; return !!m && !m.paused && m.elapsedS > 0.5; })) return;
  }
  throw new Error("the mission did not start");
}
/** Waits for a result dialog while location fixes keep coming (without them the game clock stands still, as it should). */
async function waitDialog(name) {
  const d = page.getByRole("dialog", { name });
  for (let i = 0; i < 60 && !(await d.count()); i++) await gps(1);
  await d.waitFor({ timeout: 5000 });
}
/** Moves the game clock to `leftS` seconds before the time limit (the engine does the rest on its next steps). */
const jumpToEnd = (leftS) => page.evaluate((left) => { const s = window.__outbreak.live.state; s.elapsedSeconds = s.config.durationSeconds - left; }, leftS);

try {
  // --- Main menu ---
  await page.goto(BASE + "/");
  await page.getByRole("link", { name: /CAMPAIGNS/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200); // the start page re-renders once while hydrating in headless runs
  const menu = await page.locator("main a").evaluateAll((as) => as.map((a) => a.textContent.trim()));
  check("main menu: campaigns first, then free play, previous games, how to play, settings",
    /CAMPAIGNS/.test(menu[0]) && menu[1] === "FREE PLAY" && menu[2] === "PREVIOUS GAMES" && menu[3] === "HOW TO PLAY" && menu[4] === "SETTINGS" && menu.length === 5, menu.join(" | "));
  const sizes = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { camp: r(".campcta").height, free: r(".freeplay").height }; });
  check("main menu: campaigns is the dominant entry", sizes.camp > sizes.free * 1.8, `${Math.round(sizes.camp)} px vs ${Math.round(sizes.free)} px`);
  check("main menu fits the phone", await fits());
  await page.waitForTimeout(700);
  await shot("c01-menu");

  // --- Campaign list and campaign ---
  await page.getByRole("link", { name: /CAMPAIGNS/ }).click();
  await page.waitForURL("**/campaigns");
  check("campaign list: exactly one campaign, THE FALL", (await page.locator(".campcard").count()) === 1 && (await page.locator(".campcard-title").innerText()) === "THE FALL");
  await page.waitForTimeout(500);
  await shot("c02-campaigns");
  await page.locator(".campcard").click();
  await page.waitForURL("**/campaigns/the-fall");
  await page.locator(".missioncard").first().waitFor();
  const cards = await page.locator(".missioncard").evaluateAll((bs) => bs.map((b) => ({ status: b.dataset.status, disabled: b.disabled, title: b.querySelector(".missioncard-title").textContent })));
  check("campaign: five missions in order", cards.map((c) => c.title).join("|") === "FIRST CONTACT|THE SUPPLY RUN|NO WAY BACK|THE LAST SIGNAL|FINAL EXTRACTION");
  check("campaign: first mission is next, the rest locked", cards[0].status === "next" && !cards[0].disabled && cards.slice(1).every((c) => c.status === "locked" && c.disabled));
  const imgs = await page.locator(".missioncard-bg").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage));
  check("campaign: every mission card has its picture", imgs.every((u, i) => u.includes(`/campaign/the-fall/mission-0${i + 1}.jpg`)));
  check("campaign: difficulty defaults to Normal", (await page.getByRole("button", { name: "NORMAL" }).getAttribute("aria-pressed")) === "true");
  check("campaign page fits the phone", await fits());
  await shot("c03-campaign");
  await page.getByRole("button", { name: "EASY" }).click();
  check("difficulty is saved with the progress", (await progress())?.difficulty === "easy");
  await page.reload();
  await page.locator(".missioncard").first().waitFor();
  check("difficulty survives a reload", (await page.getByRole("button", { name: "EASY" }).getAttribute("aria-pressed")) === "true");

  // --- Mission 01: intro, briefing, play, win ---
  await page.locator(".missioncard").first().click();
  await page.locator(".cine").waitFor();
  check("mission intro: cinematic with the mission name", (await page.locator(".cine-title").innerText()) === "FIRST CONTACT");
  await page.waitForTimeout(2600);
  await shot("c04-intro");
  await page.getByRole("button", { name: /SKIP/ }).click();
  await page.getByRole("button", { name: "START MISSION" }).waitFor();
  const brief = await page.locator(".brief").innerText();
  check("briefing: name, story, objective, time and start", ["FIRST CONTACT", "OBJECTIVE", "ABOUT 15 MIN", "ON FOOT", "EASY", "START MISSION"].every((x) => brief.includes(x)));
  check("briefing fits the phone", await fits());
  await gps(3);
  await shot("c05-briefing");
  check("intro is remembered as seen", (await progress())?.missions["01"].introSeen === true);
  await startMission();
  await page.waitForTimeout(600);
  await shot("c06-mission-start");
  const v1 = await page.evaluate(() => { const v = window.__outbreak.getView(); return { camp: v.match.campaign?.title, mode: v.match.mode, diff: v.match.difficulty, win: v.match.winOnTimeout, radio: v.radio?.text ?? null, limit: v.match.limitS, zombies: v.match.zombieCount }; });
  check("mission 01 runs as a campaign survival match on the chosen difficulty", v1.camp === "FIRST CONTACT" && v1.mode === "survival" && v1.diff === "easy" && v1.win === true && v1.limit === 900, JSON.stringify(v1));
  check("mission 01 opens with a radio line on screen", !!v1.radio && (await page.locator(".radiocard").count()) === 1, v1.radio ?? "");
  check("mission 01's opening line is fetched as its own recorded voice file", [200, 206].includes(voices.get("tf-m01-start")), `status ${voices.get("tf-m01-start")}`);
  check("mission 01 starts with a low threat", v1.zombies <= 2, `${v1.zombies} infected`);
  await page.waitForTimeout(3600);
  await shot("c07-mission-hud");
  await jumpToEnd(1.5);
  await waitDialog("MISSION COMPLETE");
  await page.waitForTimeout(500);
  await shot("c08-mission-complete");
  const p1 = await progress();
  check("winning mission 01 is saved and unlocks mission 02", p1.missions["01"].completed === true && p1.missions["02"].completed === false);
  check("result offers the next mission and the campaign", (await page.getByRole("link", { name: "NEXT: THE SUPPLY RUN" }).count()) === 1 && (await page.getByRole("link", { name: "BACK TO CAMPAIGN" }).count()) === 1);

  // --- Mission 02: checkpoints in any order, fail, retry ---
  await page.getByRole("link", { name: "NEXT: THE SUPPLY RUN" }).click();
  await page.waitForURL("**/campaigns/the-fall?mission=02");
  await page.locator(".cine").waitFor();
  check("next mission opens on its own intro", (await page.locator(".cine-title").innerText()) === "THE SUPPLY RUN");
  await startMission();
  await page.waitForTimeout(800);
  const v2 = await page.evaluate(() => { const m = window.__outbreak.getView().match; return { mode: m.mode, total: m.objectives?.total, any: m.objectives?.anyOrder, home: m.objectives?.progress.hasHome }; });
  check("mission 02 has three supply sites in any order and no way home", v2.mode === "mission" && v2.total === 3 && v2.any === true && v2.home === false, JSON.stringify(v2));
  await shot("c09-supply-run");
  await jumpToEnd(1);
  await waitDialog("MISSION FAILED");
  await page.waitForTimeout(500);
  await shot("c10-mission-failed");
  check("failed mission offers Retry Mission and Back to Campaign", (await page.getByRole("link", { name: "RETRY MISSION" }).count()) === 1 && (await page.getByRole("link", { name: "BACK TO CAMPAIGN" }).count()) === 1);
  const p2 = await progress();
  check("a failed mission keeps earlier progress", p2.missions["01"].completed === true && p2.missions["02"].completed === false && p2.missions["02"].failures === 1);
  await page.getByRole("link", { name: "RETRY MISSION" }).click();
  await page.waitForURL("**/campaigns/the-fall?mission=02");
  await page.getByRole("button", { name: "START MISSION" }).waitFor({ timeout: 15000 });
  check("retry opens the briefing without the intro", (await page.locator(".cine").count()) === 0);

  // --- Back in the campaign: states ---
  await page.getByRole("button", { name: "BACK TO CAMPAIGN" }).click();
  await page.locator(".missioncard").first().waitFor();
  const after = await page.locator(".missioncard").evaluateAll((bs) => bs.map((b) => b.dataset.status));
  check("campaign shows completed, next and locked missions", after.join("|") === "completed|next|locked|locked|locked", after.join("|"));
  await page.waitForTimeout(400);
  await shot("c11-campaign-progress");
  await page.screenshot({ path: `${OUT}/c12-campaign-full.png`, fullPage: true });

  // --- A locked mission cannot be reached by its link ---
  await page.goto(BASE + "/campaigns/the-fall?mission=05");
  await page.locator(".missioncard").first().waitFor();
  check("a locked mission's link shows the campaign, not the mission", (await page.locator(".brief, .cine").count()) === 0);

  // --- Free Play is where New game was ---
  await page.goto(BASE + "/");
  await page.getByRole("link", { name: "FREE PLAY" }).click();
  await page.waitForURL("**/new");
  await page.getByRole("button", { name: "ON FOOT", exact: true }).waitFor({ timeout: 15000 });
  check("Free Play opens the standalone modes", (await page.getByRole("button", { name: "BY BIKE", exact: true }).count()) === 1);
  await page.getByRole("button", { name: "ON FOOT", exact: true }).click();
  check("Free Play still offers the three modes", (await page.getByRole("button", { name: "CHECKPOINTS", exact: true }).count()) === 1 && (await page.getByRole("button", { name: "A TO B", exact: true }).count()) === 1 && (await page.getByRole("button", { name: "SURVIVAL", exact: true }).count()) === 1);

  check("every voice file the game asked for exists", voices.size > 0 && [...voices.values()].every((st) => st === 200 || st === 206 || st === 304), [...voices].map(([k, v]) => `${k}:${v}`).join(" "));
  const bad = errors.filter((e) => !/favicon|openfreemap|tiles\.|Failed to load resource|net::ERR/i.test(e));
  check("no page errors", bad.length === 0, bad.slice(0, 3).join(" ¦ "));
} catch (e) {
  check("run completed", false, String(e));
  await shot("c99-error").catch(() => undefined);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
