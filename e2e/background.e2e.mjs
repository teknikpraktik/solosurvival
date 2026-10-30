// Appbyte: spelet ska inte pausas av en kort frånvaro, tiden ska gå, och en lång frånvaro ska pausa. GPS är MOCKAD (Playwright); synlighet simuleras med visibilitychange.
// Kräver en körande server (npm run build && npx next start -p 3100).
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
const page = await ctx.newPage();
const tick = async (n = 3) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); } };
await page.goto(BASE + "/new"); await tick(4);
await page.getByRole("button", { name: "On foot", exact: true }).click();
await page.getByRole("button", { name: "SURVIVAL", exact: true }).click();
await page.getByRole("button", { name: "START", exact: true }).click(); await tick(); // Survival: START on the settings page goes straight to the game (no preview)
await page.waitForURL("**/play", { timeout: 90000 }); await tick();
await page.getByRole("dialog").getByRole("button", { name: "START" }).click();
for (let i = 0; i < 6; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(1000); }
const elapsed = () => page.evaluate(() => window.__outbreak.live.state.elapsedSeconds);
const paused = () => page.evaluate(() => window.__outbreak.live.state.paused);
const setHidden = (h) => page.evaluate((h) => { Object.defineProperty(document, "hidden", { value: h, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }, h);
check("matchen går", !(await paused()));
const e0 = await elapsed();
await setHidden(true);
await page.waitForTimeout(6000);
await setHidden(false);
await tick(2);
const e1 = await elapsed();
check("kort appbyte pausar inte spelet", !(await paused()));
check("tiden gick medan appen var borta (ingen gratis paus)", e1 - e0 > 5.5, `${(e1 - e0).toFixed(1)} s`);
check("PAUSE-knappen visas (inte CONTINUE)", await page.getByRole("button", { name: "PAUSE", exact: true }).isVisible());
// Lång frånvaro: sessionens klocka skjuts fram 60 s medan appen är dold (testläget exponerar sessionen som window.__outbreak).
await setHidden(true);
await page.evaluate(() => { const s = window.__outbreak; const real = s.now; s.now = () => real() + 60_000; });
await setHidden(false);
await tick(2);
check("lång frånvaro (60 s) pausar", await paused());
check("Continue-dialogen visas", await page.getByRole("dialog").getByRole("button", { name: /CONTINUE|WAITING/ }).isVisible().catch(() => false));
await browser.close();
process.exit(res.every(Boolean) ? 0 : 1);
