// A TO B i webbläsaren: ingen sträckereglage, välj B på kartan, rutt A→B, start. GPS är MOCKAD (Playwright), inte ett fälttest.
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const OUT = process.env.E2E_OUT ?? "e2e/out-atob";
import { mkdirSync } from "node:fs"; mkdirSync(OUT, { recursive: true });
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START, locale: "sv-SE" });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE + "/new");
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
await page.waitForTimeout(800);
await page.getByRole("button", { name: "A TO B", exact: true }).click();
check("ingen sträckereglage i A TO B", (await page.locator("#dist").count()) === 0 && (await page.locator("#dur").count()) === 0);
check("VISA RUTT låst tills B valts", await page.getByRole("button", { name: "PICK B ON THE MAP" }).isDisabled());
const map = page.getByTestId("pickmap");
await map.scrollIntoViewIfNeeded();
await page.waitForSelector('[data-testid="pickmap"] [data-loaded="true"]', { timeout: 20000 });
await page.waitForTimeout(2500);
const box = await map.boundingBox();
let ok = false, info = "";
for (const [dx, dy] of [[90, -90], [-100, -80], [110, 60], [-60, 100], [0, -120], [130, 0]]) {
  for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(200); }
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.waitForTimeout(500);
  if (!(await page.getByRole("button", { name: "SHOW ROUTE" }).isEnabled())) continue;
  await page.screenshot({ path: `${OUT}/pick.png` });
  await page.getByRole("button", { name: "SHOW ROUTE" }).click();
  try { await page.getByText(/Distance|Straight line/).first().waitFor({ timeout: 40000 }); ok = true; break; }
  catch { info = await page.locator(".sheet .card").first().innerText().catch(() => ""); await page.getByRole("button", { name: "BACK" }).click().catch(() => {}); await page.waitForTimeout(500); }
}
check("B vald på kartan ger en rutt A→B", ok, info);
if (ok) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/preview.png` });
  check("förhandsvisning visar A och B-markörer", (await page.locator('[aria-label="Objective A"]').count()) === 1 && (await page.locator('[aria-label="Objective B"]').count()) === 1);
  check("ingen 'nytt förslag' i A TO B", (await page.getByRole("button", { name: "NEW COURSE" }).count()) === 0);
  for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
  await page.getByRole("button", { name: "START", exact: true }).click();
  await page.waitForURL("**/play");
  for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
  await page.getByRole("dialog").getByRole("button", { name: "START" }).click();
  await page.waitForTimeout(1500);
  check("A TO B-match går, mål 1/1", (await page.getByText(/Goal 1\/1/).count()) === 1);
  await page.screenshot({ path: `${OUT}/play.png` });
}
check("inga JS-fel", errs.filter((e) => !/WebGL|swiftshader/i.test(e)).length === 0, errs.slice(0, 2).join(" | "));
await browser.close();
process.exit(res.every(Boolean) ? 0 : 1);
