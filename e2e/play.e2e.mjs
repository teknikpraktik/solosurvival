// Webbläsartest av hela flödet mot en körande server (npm run build && npx next start -p 3100).
// OBS: GPS är MOCKAD via Playwrights setGeolocation. Detta är ett simulerat test i headless Chromium, inte ett fälttest på riktig telefon.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "e2e/out";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " – " + info : ""}`); };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  viewport: { width: Number(process.env.VW ?? 390), height: Number(process.env.VH ?? 844) }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ["geolocation"], geolocation: START, locale: "sv-SE",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

try {
  await page.goto(BASE + "/");
  // The start page re-renders once while hydrating in headless runs: wait until the three buttons are there (up to 5 s).
  let startOk = false, startText = "";
  for (let i = 0; i < 20 && !startOk; i++) {
    startText = await page.locator("body").innerText();
    startOk = ["NEW GAME", "PREVIOUS GAMES", "HOW TO PLAY"].every((t) => startText.includes(t)) && (await page.locator("a.btn").count()) === 3;
    if (!startOk) await page.waitForTimeout(250);
  }
  check("startsida har tre knappar", startOk);
  await page.screenshot({ path: `${OUT}/01-start.png` });

  await page.getByText("NEW GAME").click();
  await page.waitForURL("**/new");
  for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(400); }
  await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/02-new.png` });

  await page.getByText("SHOW COURSE").click();
  await page.getByText(/Distance|Straight line/).first().waitFor({ timeout: 60000 });
  await page.waitForSelector('[data-testid="map"][data-loaded="true"]', { timeout: 20000 });
  check("förhandsvisning med rutt och karta", true);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/03-preview.png` });
  const hasRoute = await page.getByText(/checkpoints \+ home/).count();
  check("förhandsvisning visar checkpoints och hem", hasRoute > 0);

  await page.getByText("NEW COURSE").click();
  await page.getByText(/Distance|Straight line/).first().waitFor({ timeout: 60000 });
  check("nytt förslag", true);

  for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
  // START must lead straight to the game: the settings form (a .page with an h1) must never be rendered in between.
  await page.evaluate(() => { window.__flash = false; new MutationObserver(() => { if (document.querySelector(".page h1")) window.__flash = true; }).observe(document.body, { childList: true, subtree: true }); });
  await page.getByRole("button", { name: "START", exact: true }).click();
  await page.waitForURL("**/play");
  check("START går direkt till spelet (inställningssidan blinkar inte till)", !(await page.evaluate(() => window.__flash)));
  await page.waitForSelector('[data-testid="map"][data-loaded="true"]', { timeout: 20000 });
  for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
  await page.getByRole("dialog").getByRole("button", { name: "START" }).click();
  await page.waitForTimeout(500);
  for (let i = 0; i < 12; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(1000); }
  const timeText = await page.locator('[aria-label="Time left"]').innerText();
  check("matchen går (tid återstår)", /\d+:\d\d/.test(timeText), timeText);
  await page.screenshot({ path: `${OUT}/04-play.png` });

  // Omladdning mitt i matchen: ska återställas pausat.
  await page.reload();
  await page.waitForSelector('[data-testid="map"][data-loaded="true"]', { timeout: 20000 });
  await page.getByText(/Paused|Ready to start/).first().waitFor({ timeout: 15000 });
  check("omladdning återställer pausad match", true);
  for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(500); }
  await page.getByRole("dialog").getByRole("button", { name: "CONTINUE", exact: true }).click();
  await page.waitForTimeout(500);
  check("kan fortsätta efter återställning", (await page.locator(".controls").getByRole("button", { name: "PAUSE" }).count()) === 1);

  await page.locator(".controls").getByRole("button", { name: "QUIT" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "QUIT", exact: true }).click();
  await page.getByText("ABORTED").first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/05-finished.png` });
  check("avbryt avslutar matchen", true);

  await page.goto(BASE + "/history");
  await page.getByText(/MISSION/).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/06-history.png` });
  check("historik visar matchen", true);
  page.once("dialog", (d) => d.accept());
  await page.getByText("Delete", { exact: true }).first().click();
  await page.getByText(/No matches yet/).waitFor({ timeout: 10000 });
  check("matchen kan raderas", true);

  await page.goto(BASE + "/how-to-play");
  check("HOW TO PLAY nås via direktlänk", (await page.getByText("Safety first").count()) === 1);
  await page.goto(BASE + "/field");
  check("testläge nås via direktlänk", (await page.getByText("TEST MODE").count()) === 1);

  const mani = await (await ctx.request.get(BASE + "/manifest.webmanifest")).json();
  check("manifest har rätt namn", mani.name === "OUTBREAK – Solo Survival");
  const sw = await ctx.request.get(BASE + "/sw.js");
  check("service worker serveras", sw.ok());
} catch (e) {
  check("oväntat fel: " + String(e).slice(0, 300), false);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => undefined);
}
const real = errors.filter((e) => !/Failed to load resource|favicon|WebGL|swiftshader|GPU stall/i.test(e));
check("inga konsolfel", real.length === 0, real.slice(0, 3).join(" | "));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
