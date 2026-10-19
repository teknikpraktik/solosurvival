// Bike view: player centred, zoom fitted to 500 m ahead/behind, Track Up kept, drag holds the map ~6 s then returns. GPS is MOCKED (Playwright).
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const OUT = process.env.E2E_OUT ?? "e2e/out-bike";
import { mkdirSync } from "node:fs"; mkdirSync(OUT, { recursive: true });
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
const page = await ctx.newPage();
const tick = async (n = 3) => { for (let i = 0; i < n; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); } };
await page.goto(BASE + "/new"); await tick(4);
await page.getByRole("button", { name: "Bike", exact: true }).click();
await page.getByRole("button", { name: "SURVIVAL", exact: true }).click();
await page.getByRole("button", { name: "SHOW AREA" }).click();
await page.getByText(/Match length/).first().waitFor({ timeout: 90000 }); await tick();
await page.getByRole("button", { name: "START", exact: true }).click();
await page.waitForURL("**/play"); await tick();
await page.getByRole("dialog").getByRole("button", { name: "START" }).click();
await page.waitForTimeout(1500); await tick(2);
const map = page.locator('[data-testid="map"]');
const zoom = async () => Number(await map.getAttribute("data-zoom"));
const z0 = await zoom();
// Expected: 1000 m over the map height (844 px) at 59.4°N.
const mpp = (z) => (40075016.686 * Math.cos((59.40731 * Math.PI) / 180)) / (512 * 2 ** z);
const aheadM = (844 / 2) * mpp(z0);
check("bike view: 500 m ahead of the player", Math.abs(aheadM - 500) < 25, `zoom ${z0}, ${aheadM.toFixed(0)} m to the edge`);
const box = await page.locator(".pmark").first().boundingBox();
check("player in the middle of the screen", box && Math.abs(box.y + box.height / 2 - 422) < 30 && Math.abs(box.x + box.width / 2 - 195) < 20, box ? `y=${Math.round(box.y + box.height / 2)}` : "no marker");
await page.screenshot({ path: `${OUT}/bike-default.png` });
// Drag the map: it must stay put and then return after about 6 s.
await page.mouse.move(200, 400); await page.mouse.down(); await page.mouse.move(200, 650, { steps: 8 }); await page.mouse.up();
await page.mouse.wheel(0, -400).catch(() => {});
await page.waitForTimeout(2500); await tick(2);
const dragged = await page.locator(".pmark").first().boundingBox();
check("map stays where the user left it", dragged && Math.abs(dragged.y + dragged.height / 2 - 422) > 60, dragged ? `y=${Math.round(dragged.y + dragged.height / 2)}` : "");
await page.screenshot({ path: `${OUT}/bike-dragged.png` });
for (let i = 0; i < 12; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(1000); }
const back = await page.locator(".pmark").first().boundingBox();
check("returns to the player in the middle after ~6 s", back && Math.abs(back.y + back.height / 2 - 422) < 30);
check("zoom returns to the bike zoom", Math.abs((await zoom()) - z0) < 0.1, `zoom ${await zoom()}`);
await browser.close();
process.exit(res.every(Boolean) ? 0 : 1);
