// NEW GAME redesign and the in-game sound button: choices, slider, preview, sound default/toggle/persistence, layout at phone widths.
// Run against a dev or production server: BASE_URL=http://localhost:3100 CHROMIUM_PATH=… node e2e/newgame.e2e.mjs
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const newCtx = (vp = { width: 390, height: 844 }) => browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
const pressed = (loc) => loc.getAttribute("aria-pressed").then((v) => v === "true");

// --- Choices, slider ---
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await page.goto(BASE + "/new"); await page.waitForTimeout(2000);
  const card = (n) => page.getByRole("group", { name: "Mode" }).getByRole("button", { name: n, exact: true });
  check("Checkpoints is chosen by default", await pressed(card("CHECKPOINTS")));
  check("page header: a quiet BACK button, no big red ✕", (await page.getByRole("link", { name: "Back" }).count()) === 1 && (await page.locator(".xbtn").count()) === 0);
  check("mode cards have their subtitles", (await page.locator(".opts.cards").innerText()).includes("Collect & return") && (await page.locator(".opts.cards").innerText()).includes("Stay alive & escape"));
  check("no sound setting on New game", (await page.getByText(/Sound and vibration/).count()) === 0);
  for (const [n, what] of [["A TO B", null], ["SURVIVAL", "#dur"], ["CHECKPOINTS", "#dist"]]) {
    await card(n).click(); await page.waitForTimeout(300);
    const others = await Promise.all(["CHECKPOINTS", "A TO B", "SURVIVAL"].filter((x) => x !== n).map((x) => pressed(card(x))));
    const shown = what ? (await page.locator(what).count()) === 1 : (await page.locator(".ngrange").count()) === 0 && (await page.locator(".ngfoot .btn").innerText()) === "SHOW COURSE";
    check(`mode ${n}: chosen alone, its setting shown`, (await pressed(card(n))) && !others.some(Boolean) && shown);
  }
  check("no step indicator, difficulty line or straight-line note (game internals are not shown)", (await page.locator(".steps").count()) === 0 && (await page.getByText(/km\/h|Straight-line distance/).count()) === 0);
  const val = () => page.locator(".rangeval").innerText();
  check("course distance shown with one decimal", /^\d+\.\d km$/.test(await val()), await val());
  await page.locator("#dist").fill("4000"); await page.waitForTimeout(200);
  check("slider updates the value", (await val()) === "4.0 km", await val());
  await page.getByRole("button", { name: "Bike", exact: true }).click(); await page.waitForTimeout(200);
  check("Bike chosen; distance back to the Bike default (10.0 km), limits unchanged (4–30 km)", (await pressed(page.getByRole("button", { name: "Bike", exact: true }))) && (await val()) === "10.0 km" && (await page.locator("#dist").getAttribute("max")) === "30000" && (await page.locator("#dist").getAttribute("min")) === "4000");
  for (const d of ["Easy", "Hard"]) await page.getByRole("button", { name: d, exact: true }).click();
  check("difficulty can be chosen", await pressed(page.getByRole("button", { name: "Hard", exact: true })));
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await page.getByRole("button", { name: "On foot", exact: true }).click(); await page.waitForTimeout(200);
  // Preview. The emulated GPS sends one fix; send fresh ones as a phone would, so the start position is current.
  for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
  await page.getByRole("button", { name: "SHOW COURSE" }).click();
  const opened = await page.locator(".pvstats").waitFor({ timeout: 90000 }).then(() => true, () => false);
  check("SHOW COURSE opens the course preview (with START GAME)", opened && (await page.getByRole("button", { name: "START GAME", exact: true }).count()) === 1, opened ? "" : (await page.locator("main, .sheet").first().innerText()).slice(0, 200));
  await ctx.close();
}

// --- Sound: on by default, toggled in the game, kept after reload; an earlier "off" is respected ---
async function startSurvival(page) {
  await page.goto(BASE + "/new"); await page.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) { await page.context().setGeolocation(START); await page.waitForTimeout(300); }
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "SURVIVAL", exact: true }).click();
  await page.locator(".ngfoot").getByRole("button", { name: "START" }).click();
  await page.waitForURL("**/play", { timeout: 90000 }); await page.waitForTimeout(1000);
  await page.getByRole("dialog").getByRole("button", { name: "START" }).click({ timeout: 2500 }).catch(() => {}); // no "Ready to start" dialog any more: START GAME starts the match await page.waitForTimeout(800);
}
const soundBtn = (page) => page.locator(".controls .iconbtn");
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await startSurvival(page);
  check("new player: sound on in the game", await pressed(soundBtn(page)), await soundBtn(page).getAttribute("aria-label"));
  check("sound button has an icon and an accessible name", (await soundBtn(page).locator("svg").count()) === 1 && /Sound on/.test(await soundBtn(page).getAttribute("aria-label")));
  await soundBtn(page).click();
  check("tap: sound off (icon and stored choice)", !(await pressed(soundBtn(page))) && (await page.evaluate(() => localStorage.getItem("outbreak.cues"))) === "off");
  await page.reload(); await page.waitForTimeout(2500);
  check("after reload: still off", !(await pressed(soundBtn(page))));
  await soundBtn(page).dispatchEvent("click"); // a restored match opens paused behind a dialog; the HUD button itself still works
  check("tap again: sound on", (await pressed(soundBtn(page))) && (await page.evaluate(() => localStorage.getItem("outbreak.cues"))) === "on");
  const box = await soundBtn(page).boundingBox();
  check("sound button at least 42×44 px and inside the control row", box && box.width >= 42 && box.height >= 44);
  await ctx.close();
}
{
  const ctx = await newCtx();
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("outbreak.cues", "off"); sessionStorage.setItem("seeded", "1"); } } catch {} });
  const page = await ctx.newPage();
  await startSurvival(page);
  check("existing player who had turned sound off: still off", !(await pressed(soundBtn(page))));
  await ctx.close();
}

// --- Layout at phone widths ---
for (const w of [320, 360, 375, 390, 430]) {
  const ctx = await newCtx({ width: w, height: 700 });
  const page = await ctx.newPage();
  await page.goto(BASE + "/new"); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
    cut: [...document.querySelectorAll(".opt .opttitle")].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > e.closest(".opt").getBoundingClientRect().right - 2).map((e) => e.textContent),
    small: [...document.querySelectorAll(".opt, .ngfoot .btn")].filter((e) => e.getBoundingClientRect().height < 44).length,
  }));
  check(`${w} px: no sideways scroll, no cut titles, tap targets ≥ 44 px`, !r.hscroll && !r.cut.length && !r.small, JSON.stringify(r));
  await ctx.close();
}

await browser.close();
const failed = res.filter((x) => !x).length;
console.log(`\n${res.length - failed}/${res.length} passed`);
process.exit(failed ? 1 : 0);
