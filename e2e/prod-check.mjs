// Extra produktionskontroller: nätverksfel, service worker, headers, tiles från OpenFreeMap. GPS är MOCKAD.
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL;
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = [];
const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START, locale: "sv-SE" });
const page = await ctx.newPage();
const failed = [], bad = [], hosts = new Map();
page.on("requestfailed", (r) => failed.push(`${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
page.on("response", (r) => { const u = new URL(r.url()); hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1); if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 100)}`); });
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE + "/");
const ver = await (await ctx.request.get(BASE + "/version.json")).json();
console.log("version.json", JSON.stringify(ver));
// Service worker
await page.waitForTimeout(3000);
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? { scope: r.scope, active: !!r.active, url: r.active?.scriptURL } : null; });
check("service worker registrerad och aktiv", !!sw?.active, JSON.stringify(sw));
await page.reload(); await page.waitForTimeout(1500);
check("sidan kontrolleras av service worker efter omladdning", await page.evaluate(() => !!navigator.serviceWorker.controller));
const man = await (await ctx.request.get(BASE + "/manifest.webmanifest")).json();
check("manifest", man.name === "OUTBREAK – Solo Survival" && man.icons.length === 3, man.display);
for (const i of man.icons) { const r = await ctx.request.get(BASE + i.src); check("ikon " + i.src, r.ok() && /png/.test(r.headers()["content-type"] ?? "")); }
const tile = await ctx.request.get(BASE + "/data/v1/varmland/t/1187_135.json?v=x");
check("tile cache-header immutable", /immutable/.test(tile.headers()["cache-control"] ?? ""), tile.headers()["cache-control"]);
const mf = await ctx.request.get(BASE + "/data/v1/varmland/manifest.json");
check("datamanifest revalideras", /must-revalidate|max-age=0/.test(mf.headers()["cache-control"] ?? ""), mf.headers()["cache-control"]);
check("HTTPS/Permissions-Policy", /geolocation=\(self\)/.test((await ctx.request.get(BASE + "/")).headers()["permissions-policy"] ?? ""));
// Flöde: Survival och Escape i produktion
for (const mode of ["SURVIVAL", "CHECKPOINTS"]) // A TO B testas i e2e/atob.e2e.mjs {
  await page.goto(BASE + "/new");
  for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: mode, exact: true }).click();
  await page.getByRole("button", { name: /SHOW (ROUTE|AREA)/ }).click();
  await page.getByText(mode === "SURVIVAL" ? /Match length/ : /Distance|Straight line/).first().waitFor({ timeout: 60000 });
  await page.waitForSelector('[data-testid="map"][data-loaded="true"]', { timeout: 20000 });
  await page.waitForTimeout(2500);
  const txt = await page.locator(".sheet").innerText();
  check(`${mode}: förhandsvisning`, true, txt.replace(/\n/g, " | ").slice(0, 120));
  await page.screenshot({ path: `${process.env.OUT ?? "e2e/out-prod"}/prod-${mode}.png` });
  for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
  await page.getByRole("button", { name: "START", exact: true }).click();
  await page.waitForURL("**/play");
  for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
  await page.getByRole("dialog").getByRole("button", { name: "START" }).click();
  for (let i = 0; i < 8; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(1000); }
  const t = await page.locator('[aria-label="Time left"]').innerText();
  check(`${mode}: match går`, /\d+:\d\d/.test(t), t);
  await page.locator(".controls").getByRole("button", { name: "PAUSE" }).click();
  check(`${mode}: paus`, (await page.getByText("Paused").count()) > 0);
  await page.reload();
  await page.getByText(/Paused|Ready to start/).first().waitFor({ timeout: 15000 });
  check(`${mode}: återställs efter omladdning`, true);
  await page.getByRole("dialog").getByRole("button", { name: "QUIT", exact: true }).click(); // pausdialogen
  await page.getByRole("dialog").getByRole("button", { name: "QUIT", exact: true }).click(); // bekräftelsen
  await page.getByText("ABORTED").first().waitFor({ timeout: 10000 });
}
// Horisontell scroll / layout
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check("ingen horisontell scroll", !overflow);
console.log("värdar:", JSON.stringify([...hosts]));
const realBad = bad.filter((b) => !/favicon/.test(b));
check("inga HTTP-fel (>=400)", realBad.length === 0, realBad.slice(0, 5).join(" | "));
check("inga misslyckade nätverksanrop", failed.length === 0, failed.slice(0, 5).join(" | "));
check("inga JS-fel", errs.length === 0, errs.slice(0, 3).join(" | "));
await browser.close();
process.exit(res.every(Boolean) ? 0 : 1);
