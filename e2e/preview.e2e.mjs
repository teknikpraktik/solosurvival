// Course preview: markers (home, numbered checkpoints), fit into the visible map (compact and expanded panel, phone sizes, landscape),
// manual pan kept, REGENERATE, EDIT SETUP keeps the settings, START GAME.
// BASE_URL=http://localhost:3100 CHROMIUM_PATH=… node e2e/preview.e2e.mjs
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function open(vp, setup, afterShow) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
  await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
  const page = await ctx.newPage();
  const fixes = async (n = 3) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); } };
  await page.goto(BASE + "/new"); await page.waitForTimeout(1500); await fixes();
  if (setup) await setup(page);
  await fixes();
  await page.locator(".ngfoot .btn").click();
  if (afterShow) await afterShow(page, fixes);
  await page.locator(".pvstats").waitFor({ timeout: 90000 });
  await page.waitForTimeout(1500);
  return { ctx, page, fixes };
}
/** Course markers (home and checkpoints) and whether each is inside the map area not covered by the top bar or the panel. */
const markers = (page) => page.evaluate(() => {
  const map = document.querySelector('[data-testid="map"]').getBoundingClientRect();
  const top = document.querySelector(".pvtop .backbtn").getBoundingClientRect();
  const sheet = document.querySelector(".pvsheet").getBoundingClientRect();
  const side = sheet.left > map.left + 8;
  const area = { l: map.left, r: side ? sheet.left : map.right, t: top.bottom, b: side ? map.bottom : sheet.top };
  return [...document.querySelectorAll('[aria-label^="Objective"], .goalmark.home')].map((e) => {
    const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return { label: e.getAttribute("aria-label") ?? "Home", x: Math.round(x), y: Math.round(y), in: x >= area.l && x <= area.r && y >= area.t && y <= area.b };
  });
});
const allIn = (ms) => ms.length > 0 && ms.every((m) => m.in);

// --- Checkpoints, 390×844: markers, numbering, fit, details, pan, regenerate, back, start ---
{
  const { ctx, page, fixes } = await open({ width: 390, height: 844 }, async (p) => {
    await p.getByRole("button", { name: "Hard", exact: true }).click();
    await p.locator("#dist").fill("4000");
  });
  const ms = await markers(page);
  const wp = await page.evaluate(() => { const v = window.__outbreak.getView(); return v.prepared.proposals[v.selected].waypoints.map((w) => w.kind); });
  const nCp = wp.filter((k) => k === "checkpoint").length;
  check("home marker shown (green house)", ms.some((m) => m.label === "Home") && (await page.locator(".goalmark.home svg circle").getAttribute("fill")) === "#15803d");
  const labels = ms.filter((m) => m.label.startsWith("Objective")).map((m) => Number(m.label.split(" ")[1])).sort((a, b) => a - b);
  check("checkpoints numbered 1…n in the game's order", labels.length === nCp && labels.every((n, i) => n === i + 1), `${labels.join(",")} of ${nCp}`);
  check("compact panel: every marker in the visible map", allIn(ms), JSON.stringify(ms.filter((m) => !m.in)));
  check("summary: distance, est. time, checkpoints and time limit", (await page.locator(".pvstats dd").count()) === 3 && /\d+ \+ home/.test(await page.locator(".pvstats").innerText()) && /\d+ (h \d+ )?min/.test(await page.locator(".pvlimit b").innerText()));
  check("no warnings and no Details button in the preview", (await page.getByText(/Never cross|railway|private land/).count()) === 0 && (await page.getByRole("button", { name: /Details/ }).count()) === 0);
  // Pan by hand: the view stays where the player put it (GPS updates, panel changes).
  const before = await markers(page);
  await page.mouse.move(200, 300); await page.mouse.down(); await page.mouse.move(260, 360, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(400);
  const moved = await markers(page);
  await fixes(6); await page.waitForTimeout(600);
  const later = await markers(page);
  check("manual pan moves the map and is kept (no re-centring)", Math.abs(moved[0].x - before[0].x) > 20 && Math.abs(later[0].x - moved[0].x) < 3 && Math.abs(later[0].y - moved[0].y) < 3, `${before[0].x}→${moved[0].x}→${later[0].x}`);
  // Regenerate: a new course with the same settings, fitted again.
  const oldWp = await page.evaluate(() => JSON.stringify(window.__outbreak.getView().prepared.proposals[0].waypoints.map((w) => [w.lat, w.lon])));
  await page.getByRole("button", { name: /Regenerate/ }).click();
  await page.waitForFunction((o) => { const v = window.__outbreak.getView(); return v.stage === "preview" && v.prepared?.proposals?.[0] && JSON.stringify(v.prepared.proposals[0].waypoints.map((w) => [w.lat, w.lon])) !== o; }, oldWp, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const params = await page.evaluate(() => window.__outbreak.getView().params);
  check("REGENERATE: a new course, same settings, fitted", (await page.evaluate(() => JSON.stringify(window.__outbreak.getView().prepared.proposals[0].waypoints.map((w) => [w.lat, w.lon])))) !== oldWp && params.difficulty === "hard" && params.targetLengthM === 4000 && allIn(await markers(page)));
  // Back to New game: settings kept.
  await page.getByRole("button", { name: /Edit setup/ }).click(); await page.waitForTimeout(800);
  check("EDIT SETUP: back on New game with the settings kept", (await page.getByRole("heading", { name: "NEW GAME" }).count()) === 1 && (await page.getByRole("button", { name: "Hard", exact: true }).getAttribute("aria-pressed")) === "true" && (await page.locator(".rangeval").innerText()) === "4.0 km");
  // Start.
  await fixes(); await page.locator(".ngfoot .btn").click(); await page.locator(".pvstats").waitFor({ timeout: 90000 }); await page.waitForTimeout(800); await fixes();
  await page.getByRole("button", { name: "START GAME" }).click();
  check("START GAME starts the match", await page.waitForURL("**/play", { timeout: 60000 }).then(() => true, () => false));
  await ctx.close();
}

// --- A to B ---
{
  let pickOk = false;
  const { ctx, page } = await open({ width: 390, height: 844 }, async (p) => {
    await p.getByRole("group", { name: "Mode" }).getByRole("button", { name: "A TO B", exact: true }).click(); await p.waitForTimeout(500);
  }, async (p, fixes) => {
    // SHOW COURSE opens a full map; tap B on it, then SHOW COURSE plans the route.
    await p.getByText("Tap the map to set B").waitFor({ timeout: 10000 });
    const showDisabled = await p.locator(".pick .pvstart").isDisabled();
    await p.waitForTimeout(1500);
    const m = await p.locator('[data-testid="map"]').boundingBox(); await p.mouse.click(m.x + m.width * 0.75, m.y + m.height * 0.3); await p.waitForTimeout(500);
    pickOk = showDisabled && (await p.getByText(/B is set/).count()) === 1;
    await fixes();
    await p.locator(".pick .pvstart").click();
  });
  check("A to B: SHOW COURSE opens a full map; SHOW COURSE there is off until B is tapped", pickOk);
  const txt = await page.locator(".pvsheet").innerText();
  check("A to B: route summary with Point B, no Regenerate", /Point B/.test(txt) && (await page.getByRole("button", { name: /Regenerate/ }).count()) === 0 && (await page.getByRole("button", { name: "START GAME" }).count()) === 1);
  await ctx.close();
}

// --- Phone sizes and landscape ---
for (const vp of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
  const { ctx, page } = await open(vp);
  if (vp.height === 667 && process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const ms = await markers(page);
  const r = await page.evaluate(() => ({
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
    small: [...document.querySelectorAll(".backbtn, .pvtoggle, .pvactions .btn")].filter((e) => { const b = e.getBoundingClientRect(); return b.height < 44 || b.width < 44; }).length,
    cut: [...document.querySelectorAll(".pvstats dd, .pvstats dt, .pvactions .btn")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
    startVisible: (() => { const b = document.querySelector(".pvstart").getBoundingClientRect(); return b.bottom <= window.innerHeight && b.top >= 0; })(),
  }));
  check(`${vp.width}×${vp.height}: markers visible, nothing cut, targets ≥ 44 px, START GAME on screen`, allIn(ms) && !r.hscroll && !r.small && !r.cut.length && r.startVisible, JSON.stringify({ hidden: ms.filter((m) => !m.in).map((m) => m.label), ...r }));
  await ctx.close();
}

await browser.close();
const failed = res.filter((x) => !x).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
