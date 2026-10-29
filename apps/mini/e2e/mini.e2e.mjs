// Webbläsartest av Mini Outbreak mot en körande server (cd apps/mini && npm run build && npx next start -p 3201).
// OBS: GPS är MOCKAD via Playwrights setGeolocation. Detta är ett simulerat test i headless Chromium, inte ett fälttest på riktig telefon.
//   BASE_URL=http://localhost:3201 CHROMIUM_PATH=/path/to/chrome node apps/mini/e2e/mini.e2e.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3201";
const OUT = process.env.E2E_OUT ?? "apps/mini/e2e/out";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " – " + info : ""}`); };

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  viewport: { width: Number(process.env.VW ?? 360), height: Number(process.env.VH ?? 740) }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ["geolocation"], geolocation: START, locale: "en-GB",
});
const page = await ctx.newPage();
const errors = [];
const requests = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("request", (r) => requests.push(new URL(r.url()).pathname));

const gps = async (n = 3, ms = 400) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(ms); } };
const kinds = async () => page.evaluate(() => [...document.querySelectorAll(".zmark svg[data-kind]")].map((s) => s.getAttribute("data-kind")));
const horrorInDom = async () => page.evaluate(() => !!document.querySelector(".scare, .jump, img[src*='jump'], img[src*='captured']"));
const noHScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function newGame() {
  await page.goto(BASE + "/new");
  await page.getByRole("heading", { name: "NEW GAME" }).waitFor({ timeout: 15000 });
  await gps(4);
}

/** Startar en match på kartan (efter förhandsvisning eller direkt), trycker START i dialogen och låter den gå några sekunder. */
async function playFewSeconds(label) {
  await page.waitForURL("**/play", { timeout: 60000 });
  await page.waitForSelector('[data-testid="map"][data-loaded="true"]', { timeout: 20000 });
  await gps(3, 300);
  await page.getByRole("dialog").getByRole("button", { name: "START" }).click();
  await gps(8, 1000);
  const t = await page.locator('[aria-label="Time left"]').innerText();
  check(`${label}: matchen går`, /\d+:\d\d/.test(t), t);
  const k = await kinds();
  check(`${label}: fiender ritas med barnvänliga typer`, k.length > 0 && k.every((x) => ["cute-zombie", "rainbow-ghost", "rainbow-spider", "mini-monster"].includes(x)), `${k.length} st: ${[...new Set(k)].join(", ")}`);
  check(`${label}: ingen skräckgrafik i spelet`, !(await horrorInDom()));
  return k;
}

async function stop(label) {
  await page.locator(".controls").getByRole("button", { name: "STOP" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "STOP", exact: true }).click();
  await page.getByText("STOPPED").first().waitFor({ timeout: 10000 });
  check(`${label}: STOP avslutar`, true);
}

try {
  await page.goto(BASE + "/");
  // Första besöket: service workern tar kontroll och sidan laddas om en gång (samma beteende som OUTBREAK). Vänta ut det.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.waitForLoadState("load");
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) {
    const text = await page.locator("body").innerText();
    ok = ["MINI OUTBREAK", "NEW GAME", "MY GAMES", "HOW TO PLAY"].every((t) => text.includes(t));
    if (!ok) await page.waitForTimeout(250);
  }
  check("startsida", ok);
  check("startsidan visar alla fyra fiendetyper", (await page.locator(".parade svg[data-kind]").count()) === 4);
  check("ingen horisontell scroll (360 px)", await noHScroll());
  await page.screenshot({ path: `${OUT}/01-start.png` });

  // --- CHECKPOINTS ---
  await newGame();
  const body = await page.locator("main").innerText();
  check("bara gång: inget cykelval", (await page.getByRole("button", { name: /bike|cycl/i }).count()) === 0 && !/On Bike|Activity/.test(body) && (await page.getByRole("group", { name: "Activity" }).count()) === 0);
  check("tre spellägen erbjuds", ["CHECKPOINTS", "A TO B", "SURVIVAL"].every((t) => body.includes(t)));
  check("ingen säkerhetsruta före spelstart (borttagen på begäran)", !body.includes("Before you play") && (await page.getByRole("checkbox", { name: /watch out for traffic/i }).count()) === 0);
  await page.screenshot({ path: `${OUT}/02-new.png`, fullPage: true });
  await page.getByRole("button", { name: "SHOW COURSE" }).click();
  await page.getByText(/checkpoints \+ home/).first().waitFor({ timeout: 60000 });
  await page.waitForSelector('[data-testid="map"][data-loaded="true"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/03-preview.png` });
  await gps(3, 300);
  await page.getByRole("button", { name: "START", exact: true }).click();
  const k1 = await playFewSeconds("CHECKPOINTS");
  check("CHECKPOINTS: flera fiendetyper i samma match", new Set(k1).size >= Math.min(4, k1.length) && new Set(k1).size >= 2, [...new Set(k1)].join(", "));
  await page.screenshot({ path: `${OUT}/04-play.png` });

  // Omladdning mitt i matchen: återställs pausad, med samma typer på samma fiender.
  const before = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".zmark svg[data-kind]")].map((s, i) => [i, s.getAttribute("data-kind")])));
  await page.reload();
  await page.waitForSelector('[data-testid="map"][data-loaded="true"]', { timeout: 20000 });
  await page.getByText(/Paused|Ready to start/).first().waitFor({ timeout: 15000 });
  check("omladdning återställer pausad match", true);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".zmark svg[data-kind]")].map((s, i) => [i, s.getAttribute("data-kind")])));
  check("fiendetyperna är desamma efter återställning", JSON.stringify(Object.values(before).sort()) === JSON.stringify(Object.values(after).sort()));
  await gps(4, 500);
  // Ögonblicksbilden sparas var 10:e sekund: efter en kort match kan den återställda klockan stå på 0 (knappen heter då START).
  await page.getByRole("dialog").getByRole("button", { name: /^(START|CONTINUE)$/ }).click();
  await page.waitForTimeout(500);
  check("PAUSE finns under match", (await page.locator(".controls").getByRole("button", { name: "PAUSE" }).count()) === 1);
  await page.locator(".controls").getByRole("button", { name: "PAUSE" }).click();
  await page.getByText(/^(Paused|Ready to start)$/).first().waitFor({ timeout: 5000 });
  check("PAUSE pausar", true);
  await page.getByRole("dialog").getByRole("button", { name: "STOP" }).click();
  await page.getByRole("dialog", { name: "Stop the game?" }).getByRole("button", { name: "STOP", exact: true }).click();
  await page.getByText("STOPPED").first().waitFor({ timeout: 10000 });
  check("CHECKPOINTS: STOP från pausdialogen avslutar", true);
  await page.screenshot({ path: `${OUT}/05-finished.png` });

  // --- A TO B ---
  await newGame();
  await page.getByRole("button", { name: "A TO B" }).click();
  await page.waitForSelector('[data-testid="pickmap"] [data-testid="map"][data-loaded="true"]', { timeout: 20000 });
  await page.locator('[data-testid="pickmap"]').scrollIntoViewIfNeeded();
  // Some taps land in water or on a building and are rejected (as in OUTBREAK): try a few points.
  for (const [dx, dy] of [[0.3, -0.3], [-0.3, -0.3], [0.3, 0.3], [-0.3, 0.3], [0.1, -0.4], [-0.4, 0]]) {
    const box = await page.locator('[data-testid="pickmap"]').boundingBox();
    await page.mouse.click(box.x + box.width * (0.5 + dx), box.y + box.height * (0.5 + dy));
    await page.waitForTimeout(600);
    if (await page.getByText("Picked ✓").count()) break;
  }
  await page.getByText("Picked ✓").waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "SHOW ROUTE" }).click();
  await page.getByText(/Point B/).first().waitFor({ timeout: 60000 });
  await gps(3, 300);
  await page.getByRole("button", { name: "START", exact: true }).click();
  await playFewSeconds("A TO B");
  await page.screenshot({ path: `${OUT}/06-atob.png` });
  await stop("A TO B");

  // --- SURVIVAL (startar direkt) ---
  await newGame();
  await page.getByRole("button", { name: "SURVIVAL" }).click();
  check("SURVIVAL: helikoptern beskrivs", /helicopter/i.test(await page.locator("main").innerText()));
  await page.getByRole("button", { name: "START", exact: true }).click();
  const k3 = await playFewSeconds("SURVIVAL");
  check("SURVIVAL: flera fiendetyper i samma match", new Set(k3).size >= 2, [...new Set(k3)].join(", "));
  await page.screenshot({ path: `${OUT}/07-survival.png` });
  await stop("SURVIVAL");

  await page.goto(BASE + "/history");
  await page.getByText(/SURVIVAL/).first().waitFor({ timeout: 10000 });
  check("historiken visar spelade matcher", (await page.locator(".hist .card").count()) === 3);
  await page.screenshot({ path: `${OUT}/08-history.png` });

  await page.goto(BASE + "/how-to-play");
  check("HOW TO PLAY med säkerhet och fyra fiender", (await page.getByText("Safety first").count()) === 1 && (await page.locator(".legend svg[data-kind]").count()) === 4);
  check("HOW TO PLAY: ingen horisontell scroll", await noHScroll());
  await page.screenshot({ path: `${OUT}/09-how.png`, fullPage: true });

  // --- PWA, lagring och resurser ---
  const mani = await (await ctx.request.get(BASE + "/manifest.webmanifest")).json();
  check("manifest: namn och kortnamn", mani.name === "Mini Outbreak Solo Survival" && mani.short_name === "Mini Outbreak", `${mani.name} / ${mani.short_name}`);
  check("manifest: egen id och start", mani.id === "/?app=mini-outbreak" && mani.start_url === "/?source=pwa");
  for (const i of mani.icons) check(`ikon ${i.src} finns`, (await ctx.request.get(BASE + i.src)).ok());
  const html = await (await ctx.request.get(BASE + "/")).text();
  check("apple-web-app-titel", /apple-mobile-web-app-title" content="Mini Outbreak"/.test(html));
  const sw = await (await ctx.request.get(BASE + "/sw.js")).text();
  check("service worker med egna cachenamn", sw.includes('"mini-outbreak-static-v1"') && !sw.includes('"outbreak-static-v1"'));
  for (const p of ["/img/jump.jpg", "/img/captured.jpg", "/img/hero.jpg", "/img/backdrop.jpg", "/audio/jump-scream.wav", "/audio/captured-scream.wav", "/audio/zombie-near.wav", "/audio/tension.wav", "/audio/sprint-shriek.wav"]) {
    check(`skräckresurs saknas: ${p}`, (await ctx.request.get(BASE + p)).status() === 404);
  }
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  check("IndexedDB: bara mini-outbreak", dbs.length === 1 && dbs[0] === "mini-outbreak", dbs.join(","));
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check("localStorage: bara egna nycklar", keys.every((k) => k.startsWith("mini-outbreak.")), keys.join(","));
  const bad = requests.filter((p) => /^\/(img|audio)\//.test(p) && p !== "/audio/checkpoint.wav");
  check("inga förfrågningar efter vuxenappens bilder eller ljud", bad.length === 0, bad.join(","));
} catch (e) {
  check("oväntat fel: " + String(e).slice(0, 400), false);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => undefined);
}
const real = errors.filter((e) => !/Failed to load resource|favicon|WebGL|swiftshader|GPU stall|tiles\.openfreemap/i.test(e));
check("inga konsolfel", real.length === 0, real.slice(0, 3).join(" | "));
await browser.close();
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
