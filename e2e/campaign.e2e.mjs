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
page.on("response", (r) => { const m = /\/campaign\/the-fall\/(?:voice|narration)\/([^/?]+)\.mp3/.exec(r.url()); if (m) voices.set(m[1], r.status()); });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const gps = async (n = 3) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(350); } };
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const progress = () => page.evaluate(() => JSON.parse(localStorage.getItem("outbreak.story.regenesis") ?? "null"));
/** One mission's saved progress. */
const mp = (p, id) => p?.chapters?.["the-fall"]?.missions?.[id];
const statuses = () => page.locator(".missioncard").evaluateAll((bs) => bs.map((b) => b.dataset.status));
const onOverview = async () => { await page.locator(".missioncard").first().waitFor({ timeout: 15000 }); return (await page.locator(".brief").count()) === 0 && !new URL(page.url()).searchParams.has("mission"); };
/** No horizontal overflow: nothing is wider than the phone. */
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Starts the mission whose briefing is open, and waits for the game to run. */
async function startMission() {
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
  // --- Main menu: two equal ways to play, everything else behind the menu button ---
  await page.goto(BASE + "/");
  await page.getByRole("link", { name: /CAMPAIGN/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200); // the start page re-renders once while hydrating in headless runs
  const menu = await page.locator("main a").evaluateAll((as) => as.map((a) => a.innerText.replace(/\s+/g, " ").trim()));
  check("main menu: exactly CAMPAIGN and FREE PLAY, each with its line", menu.length === 2 && menu[0] === "CAMPAIGN STORY MISSIONS" && menu[1] === "FREE PLAY YOUR SURVIVAL. YOUR RULES.", menu.join(" | "));
  const sizes = await page.locator(".playbtn").evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), marked: b.hasAttribute("aria-current") || b.hasAttribute("aria-pressed") }; }));
  check("main menu: the two buttons are the same size and neither is marked as chosen", sizes[0].w === sizes[1].w && sizes[0].h === sizes[1].h && sizes[0].h >= 60 && sizes.every((x) => !x.marked), JSON.stringify(sizes));
  check("main menu fits the phone", await fits());
  check("new campaign: CAMPAIGN leads to the list of stories", (await page.locator('.playbtn[data-play="campaign"]').getAttribute("href")) === "/campaigns");
  await page.waitForTimeout(700);
  await shot("c01-menu");
  for (const [name, url] of [["PREVIOUS GAMES", "**/history"], ["HOW TO PLAY", "**/how-to-play"], ["SETTINGS", "**/settings"]]) {
    await page.locator(".homemore").click();
    await page.getByRole("link", { name, exact: true }).click();
    await page.waitForURL(url, { timeout: 15000 });
    await page.goto(BASE + "/");
    await page.getByRole("link", { name: /CAMPAIGN/ }).waitFor();
    await page.waitForTimeout(500);
  }
  check("the menu button opens previous games, how to play and settings", true);
  await page.locator(".homemore").click(); await page.waitForTimeout(300);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  check("the menu closes with Escape", (await page.locator(".moresheet").count()) === 0);

  // --- Campaign list and campaign ---
  await page.getByRole("link", { name: /CAMPAIGN/ }).click();
  await page.waitForURL("**/campaigns");
  await page.locator(".campcard").waitFor();
  check("campaign list: exactly one story, REGENESIS", (await page.locator(".campcard").count()) === 1 && (await page.locator(".campcard-title").innerText()) === "REGENESIS");
  await page.waitForTimeout(500);
  await shot("c02-campaigns");
  await page.locator(".campcard").click();
  await page.waitForURL("**/campaigns/regenesis");
  await page.locator(".chaptercard").first().waitFor();
  const chapters = await page.locator(".chaptercard").evaluateAll((cs) => cs.map((c) => ({ title: c.querySelector(".campcard-title").textContent, locked: c.dataset.locked === "true", link: c.tagName === "A" })));
  check("REGENESIS: five chapters in order, THE FALL playable, the other four shown locked", chapters.map((c) => c.title).join("|") === "THE FALL|GROUND ZERO|THE HUNT|NO MAN'S LAND|THE LAST HOPE" && chapters[0].link && !chapters[0].locked && chapters.slice(1).every((c) => c.locked && !c.link), JSON.stringify(chapters));
  check("REGENESIS fits the phone", await fits());
  await shot("c02b-regenesis");
  await page.locator(".chaptercard").first().click();
  await page.waitForURL("**/campaigns/the-fall");
  await page.locator(".missioncard").first().waitFor();
  const cards = await page.locator(".missioncard").evaluateAll((bs) => bs.map((b) => ({ status: b.dataset.status, disabled: b.disabled, title: b.querySelector(".missioncard-title").textContent })));
  check("campaign: five missions in order", cards.map((c) => c.title).join("|") === "FIRST CONTACT|THE SUPPLY RUN|NO WAY BACK|THE LAST SIGNAL|FINAL EXTRACTION");
  check("campaign: first mission is next, the rest locked", cards[0].status === "next" && !cards[0].disabled && cards.slice(1).every((c) => c.status === "locked" && c.disabled));
  const imgs = await page.locator(".missioncard-bg").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage));
  check("campaign: every mission card has its picture", imgs.every((u, i) => u.includes(`/campaign/the-fall/mission-0${i + 1}.jpg`)));
  check("campaign: no difficulty is marked before the player chooses", (await page.locator(".campdiff .seg button[aria-pressed=true]").count()) === 0);
  check("campaign page fits the phone", await fits());
  await shot("c03-campaign");
  await page.getByRole("button", { name: "EASY" }).click();
  const chosen = await progress();
  check("difficulty is saved with the progress", chosen?.difficulty === "easy");
  check("choosing a difficulty does not begin the campaign", chosen?.started === false && (await page.locator(".campcontinue b").innerText()) === "BEGIN");
  await page.reload();
  await page.locator(".missioncard").first().waitFor();
  check("difficulty survives a reload", (await page.getByRole("button", { name: "EASY" }).getAttribute("aria-pressed")) === "true");

  // --- Mission 01: briefing (read by the narrator), play, win ---
  await page.locator(".missioncard").first().click();
  await page.getByRole("button", { name: "START MISSION" }).waitFor();
  check("one screen before the mission: no separate intro to skip", (await page.getByRole("button", { name: /SKIP/ }).count()) === 0);
  const brief = await page.locator(".brief").innerText();
  check("briefing: name, story, objective, time and start", ["FIRST CONTACT", "OBJECTIVE", "ABOUT 15 MIN", "ON FOOT", "EASY", "START MISSION"].every((x) => brief.includes(x)));
  await page.locator('.narrate[data-state="playing"]').waitFor({ timeout: 8000 }).catch(() => undefined);
  check("the narrator reads the briefing as it opens", (await page.locator('.narrate[data-state="playing"]').count()) === 1 && [200, 206].includes(voices.get("tf-m01-briefing")), `status ${voices.get("tf-m01-briefing")}`);
  await page.getByRole("button", { name: "STOP" }).click();
  check("the narration can be stopped and listened to again", (await page.getByRole("button", { name: "LISTEN" }).count()) === 1);
  check("briefing fits the phone", await fits());
  await gps(3);
  await shot("c05-briefing");
  check("intro is remembered as seen", mp(await progress(), "01")?.introSeen === true);
  check("the campaign is not begun before a mission starts", (await progress())?.started === false);
  await startMission();
  await page.waitForTimeout(600);
  check("starting the first mission begins the campaign", (await progress())?.started === true && mp(await progress(), "01")?.attempts === 1);
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
  check("winning mission 01 is saved on EASY and unlocks mission 02", mp(p1, "01").completed === true && mp(p1, "01").bestDifficulty === "easy" && mp(p1, "02").completed === false);
  check("result in story order: the radio's last line, then what happens after it", (await page.locator(".radiolog + .outcome").count()) === 1
    && (await page.locator(".outcome").innerText()).includes("The cellar door opens") && (await page.locator(".radiolog").innerText()).includes("opening the cellar door"));
  await page.locator('.modal .narrate[data-state="playing"]').waitFor({ timeout: 15000 }).catch(() => undefined);
  check("the narrator reads what the win achieved", (await page.locator('.narrate[data-state="playing"]').count()) === 1 && [200, 206].includes(voices.get("tf-m01-debrief")), `status ${voices.get("tf-m01-debrief")}`);
  check("result offers the next mission and the campaign", (await page.getByRole("link", { name: "NEXT: THE SUPPLY RUN" }).count()) === 1 && (await page.getByRole("link", { name: "BACK TO CAMPAIGN" }).count()) === 1);

  // --- Mission 02: checkpoints in any order, fail, retry ---
  await page.getByRole("link", { name: "NEXT: THE SUPPLY RUN" }).click();
  await page.waitForURL("**/campaigns/the-fall?mission=02");
  await page.getByRole("button", { name: "START MISSION" }).waitFor({ timeout: 15000 });
  check("NEXT opens the next mission's briefing", (await page.locator(".brief-title").innerText()) === "THE SUPPLY RUN");
  await page.locator('.narrate[data-state="playing"]').waitFor({ timeout: 8000 }).catch(() => undefined);
  check("the next briefing is read too", (await page.locator('.narrate[data-state="playing"]').count()) === 1 && [200, 206].includes(voices.get("tf-m02-briefing")));
  // NEXT is a link: the phone's back button from its briefing leads to the overview, not back to the finished game.
  await page.goBack();
  check("phone back from a briefing opened by NEXT shows the overview", await onOverview());
  check("the overview shows mission 01 won on EASY", (await page.locator('.missioncard[data-status="completed"] .campchip').first().innerText()).includes("EASY"));
  await page.locator(".campcontinue").click();
  await page.locator(".brief").first().waitFor();
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
  check("a failed mission keeps earlier progress", mp(p2, "01").completed === true && mp(p2, "02").completed === false && mp(p2, "02").failures === 1);
  await page.getByRole("link", { name: "RETRY MISSION" }).click();
  await page.waitForURL("**/campaigns/the-fall?mission=02");
  await page.getByRole("button", { name: "START MISSION" }).waitFor({ timeout: 15000 });
  check("retry opens the briefing", (await page.locator(".brief-title").innerText()) === "THE SUPPLY RUN");

  // --- A reloaded briefing: both ways back still lead to the overview ---
  await page.reload();
  await page.getByRole("button", { name: "START MISSION" }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "BACK TO CAMPAIGN" }).click();
  check("‹ from a reloaded briefing shows the overview", await onOverview());
  await page.goForward();
  await page.getByRole("button", { name: "START MISSION" }).waitFor({ timeout: 15000 });
  await page.goBack();
  check("phone back from a reloaded briefing shows the overview", await onOverview());

  // --- Back in the campaign: states ---
  const after = await statuses();
  check("campaign shows completed, next and locked missions", after.join("|") === "completed|next|locked|locked|locked", after.join("|"));

  // --- Difficulty between missions: changed, kept, and nothing else moves ---
  await page.locator(".campdiff .seg button", { hasText: "HARD" }).click();
  const p3 = await progress();
  check("difficulty can be changed between missions and is saved", p3.difficulty === "hard" && (await page.locator(".campdiff .seg button", { hasText: "HARD" }).getAttribute("aria-pressed")) === "true");
  check("changing the difficulty keeps progress and records", (await statuses()).join("|") === after.join("|") && mp(p3, "01").bestDifficulty === "easy" && mp(p3, "01").completed === true);
  await page.locator(".campcontinue").click();
  await page.getByRole("button", { name: "START MISSION" }).waitFor({ timeout: 15000 });
  check("the briefing shows the new difficulty", (await page.locator(".brief-facts").innerText()).includes("HARD"));
  await page.goBack();
  check("phone back from a briefing opened by CONTINUE shows the overview", await onOverview());
  await page.waitForTimeout(400);
  await shot("c11-campaign-progress");
  await page.screenshot({ path: `${OUT}/c12-campaign-full.png`, fullPage: true });

  // --- A locked mission cannot be reached by its link ---
  await page.goto(BASE + "/campaigns/the-fall?mission=05");
  check("a locked mission's link shows the campaign, not the mission", await onOverview());

  // --- Returning player: CAMPAIGN opens the overview; CONTINUE opens the next mission's briefing ---
  await page.goto(BASE + "/");
  await page.locator('.playbtn[data-play="campaign"][data-state="resume"]').waitFor({ timeout: 15000 });
  const card = await page.locator('.playbtn[data-play="campaign"]').evaluate((a) => ({ href: a.getAttribute("href"), text: a.innerText.replace(/\s+/g, " ") }));
  check("returning player: CAMPAIGN leads to the stories", /^CAMPAIGN/.test(card.text) && card.href === "/campaigns", `${card.text} → ${card.href}`);
  await page.waitForTimeout(500);
  await shot("c13-menu-continue");
  await page.locator('.playbtn[data-play="campaign"]').click();
  await page.waitForURL("**/campaigns");
  await page.locator(".campcard").click();
  await page.waitForURL("**/campaigns/regenesis");
  await page.locator(".campcontinue").waitFor({ timeout: 15000 });
  check("REGENESIS for a returning player: CONTINUE names the next mission", (await page.locator(".campcontinue").innerText()).includes("THE SUPPLY RUN"));
  await page.locator(".chaptercard").first().click();
  await page.waitForURL("**/campaigns/the-fall");
  check("the overview shows story, chapter, progress, difficulty and CONTINUE", await onOverview()
    && (await page.locator(".camphero-k").innerText()).includes("REGENESIS") && (await page.locator(".campnext-k").innerText()).includes("1 / 5")
    && (await page.locator(".campcontinue").innerText()).includes("CONTINUE") && (await page.locator(".campcontinue").innerText()).includes("THE SUPPLY RUN")
    && (await page.locator(".campdiff .seg button[aria-pressed=true]").innerText()) === "HARD");
  await shot("c13b-overview");
  await page.locator(".campcontinue").click();
  await page.getByRole("button", { name: "START MISSION" }).waitFor({ timeout: 15000 });
  check("CONTINUE opens the next mission's briefing in one tap (no match starts by itself)", (await page.locator(".brief").count()) === 1 && (await page.evaluate(() => !window.__outbreak?.getView().match)));
  await page.getByRole("button", { name: "BACK TO CAMPAIGN" }).click();
  check("‹ from a continued briefing shows the overview", await onOverview());
  await page.locator(".missioncard").first().click();
  await page.getByRole("button", { name: "START MISSION" }).waitFor({ timeout: 15000 });
  check("a finished mission can be replayed (its briefing opens)", (await page.locator(".brief-title").innerText()) === "FIRST CONTACT");
  await page.goBack();
  check("phone back from a replay briefing shows the overview", await onOverview());

  // --- Existing (v1) progress is migrated: wins, unlocks and times stay; no award without a recorded difficulty ---
  await page.evaluate(() => {
    localStorage.removeItem("outbreak.story.regenesis");
    const m = (completed, t) => ({ completed, attempts: 1, failures: 0, introSeen: true, ...(completed ? { completedAt: 1, bestTimeS: t } : {}) });
    localStorage.setItem("outbreak.campaign.the-fall", JSON.stringify({ v: 1, campaignId: "the-fall", started: true, difficulty: "normal", missions: { "01": m(true, 900), "02": m(true, 1100), "03": m(true, 1200), "04": m(false) } }));
  });
  await page.goto(BASE + "/campaigns/the-fall");
  await page.locator(".missioncard").first().waitFor();
  await page.waitForTimeout(500);
  check("v1 progress: wins and unlocks are kept", (await statuses()).join("|") === "completed|completed|completed|next|locked");
  check("v1 progress: the chosen difficulty is kept, old wins carry no difficulty and earn no award",
    (await page.locator(".campdiff .seg button[aria-pressed=true]").innerText()) === "NORMAL" && (await page.locator(".campaward").count()) === 0
    && (await page.locator('.missioncard[data-status="completed"] .campchip').first().innerText()).includes("COMPLETED"));
  check("v1 record is left in place", await page.evaluate(() => localStorage.getItem("outbreak.campaign.the-fall") !== null));

  // --- Story award: shown from the mission results ---
  await page.evaluate(() => {
    localStorage.removeItem("outbreak.campaign.the-fall");
    const ids = ["01", "02", "03", "04", "05"];
    const missions = Object.fromEntries(ids.map((id) => [id, { completed: true, completedAt: 1, attempts: 1, failures: 0, introSeen: true, bestTimeS: 900, bestDifficulty: id === "05" ? "normal" : "hard", bestDifficultyAt: 1 }]));
    const award = { earnedAt: 1, missions: ids.map((id) => `the-fall/${id}`) };
    localStorage.setItem("outbreak.story.regenesis", JSON.stringify({ v: 2, storyId: "regenesis", difficulty: "hard", started: true, completedAt: 1, chapters: { "the-fall": { missions, completedAt: 1 } }, awards: { easy: award, normal: award } }));
  });
  await page.goto(BASE + "/campaigns/the-fall");
  await page.locator(".campaward").waitFor({ timeout: 15000 });
  check("the highest award is shown: VETERAN, with LEGEND as the next goal", (await page.locator(".campaward-name").innerText()) === "VETERAN" && (await page.locator(".campaward-sub").innerText()).includes("LEGEND"));
  check("a finished story has no CONTINUE, and every mission can be replayed", (await page.locator(".campcontinue").count()) === 0 && (await statuses()).every((x) => x === "completed"));
  check("overview with award fits the phone", await fits());
  await shot("c14-award");

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
