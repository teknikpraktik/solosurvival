// Fälttest 1-rättningar i webbläsaren: Track Up, riktningspil, dialoger (ej överlappande knappar, X), zombiemarkörer, nätverk per minut.
// GPS är MOCKAD (Playwright setGeolocation, ingen heading/speed i API:t – riktningen härleds ur förflyttning). Inte ett fälttest.
import { chromium } from "playwright-core";
import { destPoint } from "./geo.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const VW = Number(process.env.VW ?? 390), VH = Number(process.env.VH ?? 844);
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const OUT = process.env.E2E_OUT ?? "e2e/out-fix";
import { mkdirSync } from "node:fs"; mkdirSync(OUT, { recursive: true });
const res = [];
const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START, locale: "sv-SE" });
await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
const page = await ctx.newPage();
const reqs = []; const errs = [];
page.on("requestfinished", async (r) => { try { const s = await r.sizes(); reqs.push({ host: new URL(r.url()).host, url: r.url(), bytes: s.responseBodySize + s.responseHeadersSize, t: Date.now() }); } catch {} });
page.on("pageerror", (e) => errs.push(String(e)));

/** Är elementet synligt och nåbart (ingen annan ruta täcker dess mitt) och helt inom skärmen? */
const reachable = async (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const top = document.elementFromPoint(cx, cy);
  return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, hit: !!top && (el === top || el.contains(top)), w: r.width, h: r.height };
});

await page.goto(BASE + "/new");
for (let i = 0; i < 4; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
await page.waitForTimeout(800);
await page.getByRole("button", { name: "SURVIVE AND EXTRACT", exact: true }).click();
await page.getByRole("button", { name: "START", exact: true }).click(); // Survival: START on the settings page goes straight to the game (no preview)
for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }
await page.waitForURL("**/play", { timeout: 90000 });
for (let i = 0; i < 3; i++) { await ctx.setGeolocation(START); await page.waitForTimeout(300); }

// Dialog "Ready to start"
const dlg = page.getByRole("dialog", { name: "Ready to start" });
await dlg.waitFor({ timeout: 10000 });
const startBtn = dlg.getByRole("button", { name: "START" });
let r = await reachable(startBtn);
check("startdialog: STARTA helt synlig och nåbar", r.inside && r.hit, JSON.stringify(r));
const x = dlg.getByRole("button", { name: "Close" });
r = await reachable(x);
check("startdialog: X nåbar och minst 44 px", r.inside && r.hit && r.w >= 44 && r.h >= 44, `${r.w}x${r.h}`);
const xb = await x.boundingBox(), db = await dlg.locator(".modal").boundingBox();
check("startdialog: X uppe till höger i dialogen", xb.x + xb.width > db.x + db.width - 70 && xb.y < db.y + 70);
await page.screenshot({ path: `${OUT}/dialog-start.png` });
// X stänger dialogen; kontrollfältet blir nåbart
await x.click();
await page.waitForTimeout(300);
check("X stänger dialogen", (await page.getByRole("dialog").count()) === 0);
const ctrl = page.locator(".controls").getByRole("button", { name: "START" });
r = await reachable(ctrl);
check("kontrollfältets STARTA nåbart när dialogen stängts", r.inside && r.hit);
await ctrl.click();

// Gå: öst 4 m/s 25 s, 90° vänster (norr) 25 s, U-sväng (söder) 25 s.
let p = { latitude: START.latitude, longitude: START.longitude };
const map = page.locator('[data-testid="map"]');
const bearings = [];
const near = (a, b, tol) => Math.abs(((a - b + 540) % 360) - 180) <= tol;
// Mockad GPS ger bara positioner (ingen kurs/fart), så riktningen räknas ur förflyttning, som är långsammare än enhetens GPS-kurs (se heading.test.ts).
// Därför mäts hur lång tid kartan behöver på sig att vända (högst 50 s per sträcka) i stället för att anta en fast tid; mätvärdena skrivs ut.
const latencies = [];
const leg = async (bearing, secs, speed = 4) => {
  let converged = null;
  for (let i = 0; i < secs + 25; i++) {
    if (i >= secs && converged !== null) break;
    p = destPoint(p, speed, bearing); await ctx.setGeolocation({ ...p, accuracy: 6 }); await page.waitForTimeout(1000);
    if (converged === null && near(Number(await map.getAttribute("data-bearing")), bearing, 25)) converged = i + 1;
  }
  latencies.push(converged);
  bearings.push(Number(await map.getAttribute("data-bearing")));
};
const t0 = Date.now(); const reqBefore = reqs.length;
await leg(90, 25);
await page.screenshot({ path: `${OUT}/trackup-east.png` });
await leg(0, 25);
await leg(180, 25);
console.log("Track Up: sekunder tills kartan vänt inom 25° (öst, norr, söder):", JSON.stringify(latencies));
check("Track Up: kartan roterar mot färdriktningen (öst, norr, söder)", latencies.every((x) => x !== null) && near(bearings[0], 90, 25) && near(bearings[1], 0, 25) && near(bearings[2], 180, 25), `${JSON.stringify(bearings)} efter ${JSON.stringify(latencies)} s`);
check("pilen visas (har riktning)", (await page.locator(".pmark.has-heading").count()) === 1);
const minutes = (Date.now() - t0) / 60000;
const mine = reqs.slice(reqBefore);
const own = mine.filter((q) => q.host.includes("localhost") || q.host.includes("vercel.app"));
const tiles = mine.filter((q) => q.host.includes("openfreemap"));
console.log("totalt anrop under gång:", mine.length);
console.log(`NÄT per minut under gång (${minutes.toFixed(2)} min): egen server ${(own.length / minutes).toFixed(1)} anrop, ${(own.reduce((a, q) => a + q.bytes, 0) / minutes / 1024).toFixed(1)} KiB; kartrutor ${(tiles.length / minutes).toFixed(1)} anrop, ${(tiles.reduce((a, q) => a + q.bytes, 0) / minutes / 1024).toFixed(1)} KiB`);


// Zombierna rör sig faktiskt efter försprånget (magnet-jakt): jämför positioner 10 s isär.
const snap = () => page.evaluate(() => Object.fromEntries(window.__outbreak.getView().match.zombiesNear.map((z) => [z.id, [z.lat, z.lon]])));
const hav = (a, b) => { const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
const z0 = await snap();
// Mät i SPELTID, inte väggtid: spelets klocka och zombier står medvetet stilla när GPS-fixar uteblir i mer än 5 s (se ETAPP-3). Om testmaskinen är så belastad att
// inga fixar hinner levereras ska testet inte felaktigt skylla på zombierna; det väntar tills minst 8 s speltid gått (högst 45 s väggtid) och räknar rörelse per speltidssekund.
const gameT = () => page.evaluate(() => window.__outbreak.getView().match.elapsedS);
const g0 = await gameT();
let wall = 0;
for (; wall < 45; wall++) { p = destPoint(p, 1.3, 180); await ctx.setGeolocation({ ...p, accuracy: 6 }); await page.waitForTimeout(1000); if ((await gameT()) - g0 >= 8) break; }
const z1 = await snap();
const gameDt = (await gameT()) - g0;
const moved = Object.keys(z0).filter((id) => z1[id]).map((id) => hav(z0[id], z1[id]));
console.log(`zombier flyttade (m): ${moved.map((m) => m.toFixed(1)).join(",")} på ${gameDt.toFixed(1)} s speltid (${wall + 1} s väggtid)`);
const perGameSecond = moved.length ? Math.max(...moved) / Math.max(0.1, gameDt) : 0;
// Diagnostik som skrivs ut vid fel (felet ska kunna förklaras, inte döljas): spelets tillstånd och GPS/tick-räknare.
const diag = await page.evaluate(() => { const v = window.__outbreak.getView(); const m = v.match; const l = window.__outbreak.live; return { paused: m?.paused, frozen: m?.frozen, gpsLost: m?.gpsLost, needsFix: m?.needsFix, quality: v.quality, phase: m?.phase, result: m?.result, elapsedS: Math.round(m?.elapsedS ?? 0), freezes: l?.counters.freezes, stale: l?.counters.stale, jumps: l?.counters.jumps, invalid: l?.counters.invalid, fixAgeMs: v.fixAgeMs, nearestM: m?.nearestZombieM }; });
const moving = moved.length > 0 && gameDt >= 8 && perGameSecond >= 1;
if (!moving) console.log("DIAGNOSTIK vid fel:", JSON.stringify({ ...diag, gameDt, wall, perGameSecond }));
check("zombier rör sig mot spelaren efter försprånget (per speltidssekund)", moving, `${moved.length} zombier, ${perGameSecond.toFixed(1)} m/s speltid`);
// Tvinga fram en zombie 300 m bort på en kant (via felsökningshaket) och kontrollera markör + mjuk rörelse.
const placed = await page.evaluate(() => {
  const s = window.__outbreak; const live = s.live; const pos = live.filter.position;
  const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  let best = null;
  for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 10) {
    const f = d / e.lengthM; const i = Math.min(e.geometry.length - 2, Math.floor(f * (e.geometry.length - 1))); const a = e.geometry[i], b = e.geometry[i + 1]; const t = f * (e.geometry.length - 1) - i;
    const ll = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    const diff = Math.abs(hav(ll, pos) - 300); if (!best || diff < best.diff) best = { e: e.id, d, diff };
  }
  const z = live.state.zombies[0]; z.edgeId = best.e; z.distanceAlongEdgeM = best.d; z.route = []; z.state = "patrol";
  return best;
});
await page.waitForTimeout(1500);
check("zombiemarkör (SVG-ansikte) syns när zombie är 300 m bort", (await page.locator(".zmark svg.zsvg").count()) >= 1, JSON.stringify(placed));
await page.screenshot({ path: `${OUT}/zombie-on-map.png` });
const labels = await page.locator(".zlabel").evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== "0").map((e) => e.textContent));
console.log("avståndsetiketter:", JSON.stringify(labels));
check("avstånd skrivs vid högst de tre närmaste zombierna", labels.length >= 1 && labels.length <= 3 && labels.every((t) => /^\d+ m$|^\d\.\d km$/.test(t)));
check("ingen GPS-info i HUD:en", !(await page.locator(".hudbar").innerText()).includes("GPS"));
check("HUD-rutan med zombieavstånd är borta", (await page.locator(".hudbar .pill").filter({ hasText: /^Zombie \d|Inga zombier/ }).count()) === 0);
const jumps = await page.evaluate(() => new Promise((resolve) => {
  const el = document.querySelector(".zmark"); if (!el) return resolve(null);
  let last = null, max = 0, n = 0; const t0 = performance.now();
  const f = (now) => { const r = el.getBoundingClientRect(); if (last) max = Math.max(max, Math.hypot(r.x - last.x, r.y - last.y)); last = { x: r.x, y: r.y }; n++; if (now - t0 < 3000) requestAnimationFrame(f); else resolve({ maxPx: max, frames: n }); };
  requestAnimationFrame(f);
}));
console.log("zombiemarkör rörelse:", JSON.stringify(jumps));
check("zombiemarkören hoppar inte mellan bildrutor (< 6 px/bildruta)", jumps !== null && jumps.maxPx < 6, JSON.stringify(jumps));

// Kompass: byt till North Up
const compass = page.locator(".controls .compass");
await compass.click(); await page.waitForTimeout(1500);
check("kompassknappen byter till North Up", near(Number(await map.getAttribute("data-bearing")), 0, 6));
await compass.click(); await page.waitForTimeout(300);

// Paus → dialog → nåbara knappar (håll GPS färsk, annars visar dialogen korrekt "VÄNTAR PÅ GPS…")
for (let i = 0; i < 3; i++) { await ctx.setGeolocation({ ...p, accuracy: 6 }); await page.waitForTimeout(500); }
await page.locator(".controls").getByRole("button", { name: "PAUSE" }).click();
const pd = page.getByRole("dialog", { name: "Paused" });
await pd.waitFor();
for (const name of ["CONTINUE", "QUIT"]) { r = await reachable(pd.getByRole("button", { name, exact: true })); check(`pausdialog: ${name} nåbar`, r.inside && r.hit); }
await page.screenshot({ path: `${OUT}/dialog-pause.png` });
// Avsluta-bekräftelse
await pd.getByRole("button", { name: "QUIT" }).click();
const cd = page.getByRole("dialog", { name: "Quit the match?" });
await cd.waitFor();
for (const name of ["QUIT", "KEEP PLAYING", "Close"]) { r = await reachable(cd.getByRole("button", { name, exact: true })); check(`bekräftelse: ${name} nåbar`, r.inside && r.hit); }
await cd.getByRole("button", { name: "QUIT", exact: true }).click();
const fd = page.getByRole("dialog", { name: "ABORTED" });
await fd.waitFor();
check("Match slut: inget X (obligatoriskt beslut)", (await fd.getByRole("button", { name: "Close" }).count()) === 0);
// En avbruten match har inget "PREVIOUS GAMES" (bara HOME): det är avsiktligt i Play.tsx.
for (const name of ["HOME"]) { r = await reachable(fd.getByText(name, { exact: true })); check(`Match slut: ${name} nåbar`, r.inside && r.hit); }
await page.screenshot({ path: `${OUT}/dialog-end.png` });

// Sidor: X uppe till höger
for (const [url, t] of [["/how-to-play", "HOW TO PLAY"], ["/history", "PREVIOUS GAMES"], ["/field", "TEST MODE"]]) {
  await page.goto(BASE + url);
  r = await reachable(page.getByRole("link", { name: "Close" }));
  check(`${t}: ✕ nåbar (≥44 px)`, r.inside && r.hit && r.w >= 44);
}
const real = errs.filter((e) => !/WebGL|swiftshader/i.test(e));
check("inga JS-fel", real.length === 0, real.slice(0, 2).join(" | "));
await browser.close();
process.exit(res.every(Boolean) ? 0 : 1);
