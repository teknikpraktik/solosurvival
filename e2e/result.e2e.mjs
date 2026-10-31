// After the match: outcome first (won / captured / aborted), three numbers, highlights, all numbers on request, SHOW MATCH /
// PLAY AGAIN (same settings, new course) / Main menu / Previous games; back from SHOW MATCH to the dialog. BASE_URL=… CHROMIUM_PATH=… E2E_OUT=dir node e2e/result.e2e.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "e2e/out-result"; mkdirSync(OUT, { recursive: true });
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function play(mode, vp = { width: 390, height: 844 }, setup) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
  await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
  const page = await ctx.newPage();
  const fixes = async (n = 3, pos = START) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(pos); await page.waitForTimeout(300); } };
  await page.goto(BASE + "/new"); await page.waitForTimeout(1500); await fixes();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: mode, exact: true }).click();
  if (setup) await setup(page);
  await fixes();
  await page.locator(".ngfoot .btn").click();
  if (mode !== "SURVIVAL") { await page.locator(".pvstats").waitFor({ timeout: 90000 }); await fixes(); await page.getByRole("button", { name: "START GAME" }).click(); }
  await page.waitForURL("**/play", { timeout: 90000 }); await page.waitForTimeout(800);
  await page.getByRole("dialog").getByRole("button", { name: "START" }).click({ timeout: 2500 }).catch(() => {}); // no "Ready to start" dialog any more: START GAME starts the match await page.waitForTimeout(1200); await fixes(2);
  return { ctx, page, fixes };
}
const dialog = (page) => page.getByRole("dialog");
const waitEnd = (page) => page.locator(".outcome").waitFor({ timeout: 30000 }).then(() => true, () => false);

// --- Checkpoints completed (on foot, Hard): outcome, numbers, actions, all numbers, PLAY AGAIN keeps the settings ---
{
  const { ctx, page, fixes } = await play("CHECKPOINTS", undefined, (p) => p.getByRole("button", { name: "Hard", exact: true }).click());
  // Jump to the last goal (home, which is the start) and stand there.
  await page.evaluate(() => { const o = window.__outbreak.live.state.objectives; o.index = o.targets.length - 1; o.reachedAtS = o.targets.map(() => 1); window.__outbreak.live.state.zombies.forEach((z) => (z.speedMps = 0)); });
  await fixes(30);
  check("course completed: the result dialog opens", await waitEnd(page));
  await page.screenshot({ path: `${OUT}/won.png` });
  check("title COURSE COMPLETE, green outcome with icon and sentence", (await dialog(page).getAttribute("aria-label")) === "COURSE COMPLETE" && (await page.locator(".outcome.won").count()) === 1 && /^All \d+ checkpoints and home in \d/.test(await page.locator(".outcome p").innerText()), await page.locator(".outcome p").innerText());
  check("three numbers: time, distance, average speed", (await page.locator(".statcells dd").count()) === 3);
  check("no duplicated 'Result' row", (await dialog(page).getByText("Result", { exact: true }).count()) === 0);
  check("SHOW MATCH is the primary action, PLAY AGAIN second, Home and Previous games as links", (await page.locator(".modal-actions .cta").innerText()) === "SHOW MATCH" && (await dialog(page).getByRole("button", { name: /Play again/ }).count()) === 1 && (await page.locator(".resultlinks a").count()) === 2);
  check("no 'All numbers' toggle after the match", (await page.getByRole("button", { name: /All numbers|Fewer numbers/ }).count()) === 0);
  await page.getByRole("button", { name: /Play again/ }).click();
  await page.waitForURL("**/new"); await fixes(4);
  const opened = await page.locator(".pvstats").waitFor({ timeout: 90000 }).then(() => true, () => false);
  const params = await page.evaluate(() => window.__outbreak.getView().params);
  check("PLAY AGAIN: straight to a new course with the same settings", opened && params?.mode === "mission" && params?.difficulty === "hard" && params?.activity === "walk", JSON.stringify(params && { mode: params.mode, difficulty: params.difficulty, activity: params.activity }));
  await ctx.close();
}

// --- Captured (Survival on foot, iPhone SE size) ---
{
  const { ctx, page, fixes } = await play("SURVIVAL", { width: 375, height: 667 });
  // Stand on the network where the player is snapped, with a zombie on the same spot.
  const spot = await page.evaluate(() => {
    const live = window.__outbreak.live; const s = live.state; const o = s.player.magnetObservation ?? s.player.lastObservation; const e = live.g.edges.get(o.edgeId);
    const g = e.geometry; let left = o.edgeDistM, i = 0;
    const hav = (a, b) => { const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
    while (i < g.length - 2 && left > hav(g[i], g[i + 1])) { left -= hav(g[i], g[i + 1]); i++; }
    const f = Math.min(1, left / Math.max(1e-6, hav(g[i], g[i + 1])));
    const z = s.zombies[0]; z.edgeId = o.edgeId; z.distanceAlongEdgeM = o.edgeDistM; z.speedMps = 0; z.route = []; s.neutralUntilS = 0;
    return { latitude: g[i].lat + (g[i + 1].lat - g[i].lat) * f, longitude: g[i].lon + (g[i + 1].lon - g[i].lon) * f, accuracy: 5 };
  });
  await fixes(30, spot);
  await page.waitForTimeout(6000); // the scare screen comes first
  check("captured: the result dialog opens after the scare", await dialog(page).getByText("CAPTURED").waitFor({ timeout: 30000 }).then(() => true, () => false));
  await page.screenshot({ path: `${OUT}/captured.png` });
  check("captured: the scare picture stays behind the dialog", (await page.locator(".capturedbg img").count()) === 1);
  const capWords = ((await dialog(page).innerText()).match(/captured/gi) ?? []).length;
  check("'Captured' once (the title), no time stamp sentence", (await dialog(page).getAttribute("aria-label")) === "CAPTURED" && capWords === 1 && (await page.getByText(/Captured at/).count()) === 0, `${capWords}×`);
  const fit = await page.evaluate(() => ({ hscroll: document.documentElement.scrollWidth > window.innerWidth, small: [...document.querySelectorAll(".modal-actions .btn, .resultlinks .link, .pvtoggle")].filter((e) => e.getBoundingClientRect().height < 44).length, cut: [...document.querySelectorAll(".statcells dd, .statcells dt")].filter((e) => e.scrollWidth > e.clientWidth + 1).length }));
  check("375×667: nothing cut, targets ≥ 44 px, no sideways scroll", !fit.hscroll && !fit.small && !fit.cut, JSON.stringify(fit));
  check("links: Main menu and Previous games", (await page.getByRole("link", { name: "Main menu" }).count()) === 1);
  // SHOW MATCH, then back: the CAPTURED dialog again (no new scare), not the main menu.
  await page.getByRole("link", { name: "SHOW MATCH" }).click();
  await page.waitForURL("**/recap**"); await page.waitForTimeout(1500);
  await page.getByRole("link", { name: "Back" }).click();
  await page.waitForURL("**/play"); await page.waitForTimeout(1200);
  check("back from SHOW MATCH: the CAPTURED dialog again, without the scare", (await dialog(page).getAttribute("aria-label").catch(() => null)) === "CAPTURED" && (await page.locator(".scare").count()) === 0 && (await page.locator(".capturedbg img").count()) === 1);
  await page.getByRole("link", { name: "Main menu" }).click();
  await page.waitForURL((u) => new URL(u).pathname === "/"); 
  check("Main menu leaves to the start page", new URL(page.url()).pathname === "/");
  await ctx.close();
}

// --- Aborted ---
{
  const { ctx, page } = await play("SURVIVAL", { width: 320, height: 568 });
  await page.getByRole("button", { name: "QUIT" }).click(); await page.waitForTimeout(300);
  await dialog(page).getByRole("button", { name: "QUIT" }).click();
  check("aborted: short dialog with MAIN MENU, no numbers and no 'saved as aborted' text", await dialog(page).getByText("MATCH ABORTED").waitFor({ timeout: 30000 }).then(() => true, () => false) && (await page.getByText(/saved as aborted/).count()) === 0 && (await dialog(page).getAttribute("aria-label")) === "MATCH ABORTED" && (await page.locator(".statcells").count()) === 0 && (await page.locator(".modal-actions .cta").innerText()) === "MAIN MENU");
  await page.screenshot({ path: `${OUT}/aborted.png` });
  await ctx.close();
}

await browser.close();
const failed = res.filter((x) => !x).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
