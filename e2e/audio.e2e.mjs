// Soundscape in the real app (built, in Chromium): menu music across pages and out at match start, threat pulse from a real zombie
// distance, Survival helicopter phases, quit and a new match leaving nothing playing, and which audio files are fetched.
// GPS is MOCKED and match time/zombies are moved through the debug handles (window.__outbreak, window.__outbreakAudio).
// What is checked is what plays (element and voice state), NOT how it sounds: nobody listens here.
// BASE_URL=http://localhost:3100 node e2e/audio.e2e.mjs
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const START = { latitude: 59.40731, longitude: 13.46753, accuracy: 6 };
const res = []; const check = (n, ok, i = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${i ? " – " + i : ""}`); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: START });
  await ctx.addInitScript(() => { try { localStorage.setItem("outbreak.debug", "on"); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const reqs = []; page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/audio/")) reqs.push(u.pathname); });
  const wait = async (ms) => { for (let t = 0; t < ms; t += 400) { await ctx.setGeolocation(START); await page.waitForTimeout(400); } };
  return { ctx, page, wait, reqs };
}
/** The music elements: which play, where they are and their gain. */
const music = (page) => page.evaluate(() => {
  const m = window.__outbreakAudio?.soundscape.music;
  return { playing: m?.playing ?? false, els: (m?.els ?? []).map((e) => ({ paused: e.el.paused, t: e.el.currentTime, gain: e.gain?.gain.value ?? null, src: e.el.src.slice(0, 5) })) };
});
const audio = (page) => page.evaluate(() => { const a = window.__outbreakAudio; return { ...a.match.state, voices: a.soundscape.voiceCount, ctx: a.soundscape.context()?.state }; });
/** Puts one zombie `m` metres from the player along the trails and keeps it still; removes the others. */
const zombieAt = (page, m) => page.evaluate((want) => {
  const live = window.__outbreak.live; const pos = live.filter.position;
  const hav = (a, b) => { const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
  let best = null;
  for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 5) {
    const f = d / e.lengthM; const i = Math.min(e.geometry.length - 2, Math.floor(f * (e.geometry.length - 1))); const a = e.geometry[i], b = e.geometry[i + 1]; const t = f * (e.geometry.length - 1) - i;
    const diff = Math.abs(hav({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }, pos) - want); if (!best || diff < best.diff) best = { e: e.id, d, diff };
  }
  live.state.zombies = live.state.zombies.slice(0, 1);
  const z = live.state.zombies[0]; z.edgeId = best.e; z.distanceAlongEdgeM = best.d; z.route = []; z.speedMps = 0; z.state = "patrol";
  live.rules.zombieSpeedMps = 0; live.rules.initialZombies = 1; live.rules.maxZombies = 1;
  return Math.round(best.diff);
}, m);
async function startMatch(o, mode) {
  const { page, wait } = o;
  await page.getByRole("button", { name: "ON FOOT", exact: true }).click();
  await page.getByRole("button", { name: mode, exact: true }).click(); await wait(800);
  if (mode !== "SURVIVAL") await page.locator(".pvstats").waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: "START GAME" }).click();
  await page.waitForURL("**/play", { timeout: 90000 });
  for (let i = 0; i < 40 && !(await page.evaluate(() => { const m = window.__outbreak?.getView().match; return !!m && !m.paused; })); i++) await wait(400);
}

// --- Menu music, a Checkpoints match, quit ---
{
  const o = await open(); const { page, wait, reqs } = o;
  await page.goto(BASE + "/"); await page.waitForTimeout(1500);
  let mu = await music(page);
  check("start page: no sound before a tap", !mu.playing && mu.els.every((e) => e.paused), JSON.stringify(mu));
  check("start page: no match sounds fetched yet", !reqs.some((p) => p !== "/audio/theme-outbreak.mp3"), reqs.join(","));
  await page.getByRole("link", { name: "NEW GAME" }).click();
  await page.waitForURL("**/new"); await wait(2400);
  mu = await music(page);
  const el0 = mu.els.findIndex((e) => !e.paused);
  check("menu music starts at the first tap (NEW GAME), one element, faded in", mu.playing && mu.els.filter((e) => !e.paused).length === 1 && (mu.els[el0]?.gain ?? 0) > 0.5, JSON.stringify(mu));
  check("music: plays from the cached file (blob URL) past the leading silence", mu.els[el0]?.src === "blob:" && mu.els[el0].t >= 4, JSON.stringify(mu.els[el0]));
  const t1 = mu.els[el0]?.t ?? 0;
  await page.getByRole("button", { name: "ON FOOT", exact: true }).click(); await wait(800);
  await page.getByRole("button", { name: "CHECKPOINTS", exact: true }).click(); await wait(1600);
  mu = await music(page);
  check("music continues through the setup steps without restarting", mu.els.findIndex((e) => !e.paused) === el0 && mu.els[el0].t > t1 + 1.5, `${t1.toFixed(1)} → ${mu.els[el0]?.t.toFixed(1)}`);
  const want = ["/audio/threat-pulse-1.mp3", "/audio/captured.mp3", "/audio/checkpoint-reached.mp3", "/audio/radio-open.mp3", "/audio/zombie-near.mp3"];
  check("setup: the match sounds are fetched in the background", want.every((p) => reqs.includes(p)), [...new Set(reqs)].join(","));
  check("setup: helicopter sounds not fetched for a Checkpoints match", !reqs.some((p) => p.includes("heli")));
  await page.locator(".pvstats").waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: "START GAME" }).click();
  await page.waitForURL("**/play", { timeout: 90000 });
  for (let i = 0; i < 40 && !(await page.evaluate(() => { const m = window.__outbreak?.getView().match; return !!m && !m.paused; })); i++) await wait(400);
  await wait(800);
  mu = await music(page);
  check("match start: the music is fading out", mu.els.every((e) => (e.gain ?? 0) < 0.95), JSON.stringify(mu.els));
  await wait(2800);
  mu = await music(page);
  check("match: music gone ≈ 2.5 s after the start", !mu.playing && mu.els.every((e) => e.paused), JSON.stringify(mu));
  check("audio context running after the taps", (await audio(page)).ctx === "running");
  // Threat pulse from a real zombie distance.
  check("zombie placed ≈ 400 m away", (await zombieAt(page, 400)) < 30);
  await wait(5000);
  check("calm with the nearest zombie ≈ 400 m (on foot)", (await audio(page)).threat === null, JSON.stringify(await audio(page)));
  await zombieAt(page, 160);
  await wait(6000);
  const a1 = await audio(page);
  check("threat pulse after the zombie stayed within 200 m", typeof a1.threat === "string" && a1.threat.includes("threat-pulse-"), JSON.stringify(a1));
  await wait(6000);
  check("still the same single pulse", (await audio(page)).threat === a1.threat);
  await page.getByRole("button", { name: "QUIT" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "QUIT" }).click();
  await wait(2000);
  const a2 = await audio(page);
  check("quit: nothing of the match keeps sounding", a2.threat === null && a2.voices === 0, JSON.stringify(a2));
  await page.waitForURL(BASE + "/"); await wait(2000); // QUIT goes straight to the start page
  mu = await music(page);
  check("back to the menu: the music comes back", mu.playing && mu.els.some((e) => !e.paused), JSON.stringify(mu));
  await o.ctx.close();
}

// --- Survival helicopter phases and a win ---
{
  const o = await open(); const { page, wait, reqs } = o;
  await page.goto(BASE + "/new"); await wait(1200);
  await startMatch(o, "SURVIVAL");
  await wait(1500);
  check("Survival: helicopter sounds fetched at the match start", ["/audio/heli-approach.mp3", "/audio/heli-extraction.mp3", "/audio/heli-extraction-success.mp3"].every((p) => reqs.includes(p)), [...new Set(reqs)].join(","));
  await page.evaluate(() => { const l = window.__outbreak.live; l.state.zombies = []; l.state.elapsedSeconds = l.rules.extractionOpensAtS - 61; });
  await wait(2500);
  let a = await audio(page);
  check("approach: the helicopter is heard with its card", a.approach === true && (await page.locator(".helicard[data-kind=approaching]").count()) === 1, JSON.stringify(a));
  await page.evaluate(() => { const l = window.__outbreak.live; l.state.elapsedSeconds = l.rules.extractionOpensAtS - 0.5; });
  await wait(4000);
  a = await audio(page);
  check("extraction open: the waiting loop plays, the approach has faded out", a.heliLoop === true && a.approach === false, JSON.stringify(a));
  await page.evaluate(() => { const s = window.__outbreak; s.live.state.phase = "finished"; s.live.state.result = "survived"; s.endMatch([{ type: "finished", result: "survived" }]); });
  await wait(1500);
  a = await audio(page);
  check("win: the loop ends; the success sound and the operator's line play", a.heliLoop === false && a.threat === null && a.voices === 2 && a.voice === "liftingOff", JSON.stringify(a));
  await wait(8000);
  check("after the success sound: silence", (await audio(page)).voices === 0);
  await o.ctx.close();
}

let v;
// --- Operator's radio lines: one per real game moment, in the real app ---
const voices = (page) => page.evaluate(() => ({ log: [...window.__outbreakAudio.match.radio.log], now: window.__outbreakAudio.match.radio.speaking, queued: window.__outbreakAudio.match.radio.queued }));
{
  // A TO B: start → safe house on the map; win at B → inside the safe house. Quit while a line plays → silence, then a new match.
  const o = await open(); const { page, wait } = o;
  await page.goto(BASE + "/new"); await wait(1200);
  await page.getByRole("button", { name: "ON FOOT", exact: true }).click();
  await page.getByRole("button", { name: "A TO B", exact: true }).click(); await wait(800);
  await page.waitForSelector('[data-loaded="true"]', { timeout: 20000, state: "attached" }); await wait(1200);
  for (const [x, y] of [[280, 220], [110, 200], [300, 320], [90, 330], [200, 150], [330, 260]]) {
    await page.mouse.click(x, y); await wait(600);
    if ((await page.locator('[aria-label="Objective B"]').count()) === 0) continue;
    if (await page.locator(".pvstats").waitFor({ timeout: 60000 }).then(() => true, () => false) && await page.getByRole("button", { name: "START GAME" }).isEnabled()) break;
  }
  v = await voices(page);
  check("A TO B setup: no line before the match starts", v.log.length === 0, JSON.stringify(v));
  await page.getByRole("button", { name: "START GAME" }).click();
  await page.waitForURL("**/play", { timeout: 90000 });
  for (let i = 0; i < 40 && !(await page.evaluate(() => { const m = window.__outbreak?.getView().match; return !!m && !m.paused; })); i++) await wait(400);
  await wait(1200);
  v = await voices(page);
  check("A TO B start: \"Safe house marked on your map\" once (no \"Game on\")", v.log.join() === "safehouseOnMap" && v.now === "safehouseOnMap", JSON.stringify(v));
  check("A TO B: the line was fetched", o.reqs.includes("/audio/safehouse-on-map.mp3"));
  await page.locator(".controls").getByRole("button", { name: "PAUSE" }).click(); await wait(800);
  await page.getByRole("dialog").getByRole("button", { name: "CONTINUE" }).click(); await wait(1500);
  check("pause and continue: the start line is not said again", (await voices(page)).log.join() === "safehouseOnMap");
  // QUIT while the line plays: silence, nothing later.
  await page.locator(".controls").getByRole("button", { name: "QUIT" }).click();
  // A line playing and one waiting behind it at the moment QUIT is confirmed.
  await page.evaluate(() => { const r = window.__outbreakAudio.match.radio; void r.say("safehouseOnMap", { final: true }); void r.say("checkpointSecured"); });
  const before = await voices(page);
  await page.getByRole("dialog", { name: "Quit the match?" }).getByRole("button", { name: "QUIT", exact: true }).click();
  await page.waitForURL(BASE + "/"); await wait(9000);
  v = await voices(page);
  check("(at QUIT: one line playing, one waiting)", before.now === "safehouseOnMap" && before.queued === "checkpointSecured", JSON.stringify(before));
  const a = await audio(page);
  check("quit while a line plays and one waits: both gone, no voice later", v.now === null && v.queued === null && !v.log.includes("checkpointSecured") && a.voices === 0, JSON.stringify({ v, a }));
  await o.ctx.close();
}
{
  // Checkpoints: "Game on" is spoken (no recording); checkpoint → "Checkpoint secured"; the last → "Get to the safe house"; home → "You're inside".
  const o = await open(); const { page, wait } = o;
  await page.goto(BASE + "/new"); await wait(1200);
  await startMatch(o, "CHECKPOINTS");
  await wait(1500);
  check("Checkpoints start: no recorded line (the spoken \"Game on\" stays)", (await voices(page)).log.length === 0);
  await page.evaluate(() => { window.__outbreak.live.state.zombies = []; window.__outbreak.live.rules.maxZombies = 0; });
  const reach = (i) => page.evaluate((k) => { const s = window.__outbreak; const o = s.live.state.objectives; o.index = k + 1; s.endMatch([{ type: "objective_reached", targetId: o.targets[k].id, index: k }]); }, i);
  const n = await page.evaluate(() => window.__outbreak.live.state.objectives.targets.filter((x) => x.kind === "checkpoint").length);
  await reach(0); await wait(600);
  check("checkpoint: \"Checkpoint secured\", and the old chime is not played", (await voices(page)).now === "checkpointSecured" && (await page.evaluate(() => window.__outbreakAudio.soundscape.voiceCount)) === 1);
  await wait(5500);
  for (let i = 1; i < n - 1; i++) { await reach(i); await wait(5600); }
  await reach(n - 1); await wait(600);
  v = await voices(page);
  check("last checkpoint: \"All checkpoints secured. Get to the safe house\" instead", v.now === "getToSafehouse" && v.log.filter((l) => l === "getToSafehouse").length === 1, JSON.stringify(v));
  await wait(7500);
  // Home: the win.
  await page.evaluate(() => { const s = window.__outbreak; s.live.state.phase = "finished"; s.live.state.result = "survived"; s.endMatch([{ type: "finished", result: "survived" }]); });
  await wait(800);
  v = await voices(page);
  check("home reached: \"You're inside. Lock the door.\" with the safe-house ending", v.now === "insideSafehouse" && (await page.locator('.resultbg[data-pic="safehouse"]').count()) === 1, JSON.stringify(v));
  // Leaving the ending stops the voice.
  await page.getByRole("button", { name: /PLAY AGAIN/i }).first().click();
  await wait(1200);
  check("leaving the ending (PLAY AGAIN) stops the line", (await voices(page)).now === null);
  await o.ctx.close();
}
{
  // Survival: start → keep moving; approach → rescue inbound (with the card); landing → get to the helicopter (with the card); win → lifting off.
  const o = await open(); const { page, wait } = o;
  await page.goto(BASE + "/new"); await wait(1200);
  await startMatch(o, "SURVIVAL");
  await wait(1000);
  check("Survival start: \"Keep moving\"", (await voices(page)).log.join() === "keepMoving");
  await wait(8000);
  await page.evaluate(() => { const l = window.__outbreak.live; l.state.zombies = []; l.rules.maxZombies = 0; l.state.elapsedSeconds = l.rules.extractionOpensAtS - 61; });
  await wait(1500);
  check("approach: \"Rescue inbound\" with the approaching card, before the landing", (await voices(page)).now === "rescueInbound" && (await page.locator(".helicard[data-kind=approaching]").count()) === 1 && (await page.evaluate(() => window.__outbreak.getView().match.phase)) !== "extraction");
  await wait(6000);
  await page.evaluate(() => { const l = window.__outbreak.live; l.state.elapsedSeconds = l.rules.extractionOpensAtS - 0.5; });
  await wait(1500);
  check("extraction open: \"Get to the helicopter\" with the landed card", (await voices(page)).now === "getToHelicopter" && (await page.locator(".helicard[data-kind=landed]").count()) === 1);
  await wait(7500);
  await page.evaluate(() => { const s = window.__outbreak; s.live.state.phase = "finished"; s.live.state.result = "survived"; s.endMatch([{ type: "finished", result: "survived" }]); });
  await wait(800);
  v = await voices(page);
  check("rescued: \"Lifting off. You made it.\" with the extracted ending; each line once", v.now === "liftingOff" && v.log.join() === "keepMoving,rescueInbound,getToHelicopter,liftingOff" && (await page.locator('.resultbg[data-pic="extracted"]').count()) === 1, JSON.stringify(v));
  check("Survival lines fetched", ["/audio/keep-moving.mp3", "/audio/rescue-inbound.mp3", "/audio/get-to-helicopter.mp3", "/audio/lifting-off.mp3"].every((p) => o.reqs.includes(p)));
  await o.ctx.close();
}
{
  // Captured while a line plays: it stops, and the next match opens with its own line.
  const o = await open(); const { page, wait } = o;
  await page.goto(BASE + "/new"); await wait(1200);
  await startMatch(o, "SURVIVAL");
  await wait(1000);
  await page.evaluate(() => { const s = window.__outbreak; s.live.state.phase = "finished"; s.live.state.result = "infected"; s.endMatch([{ type: "finished", result: "infected" }]); });
  await wait(600);
  v = await voices(page);
  check("captured while \"Keep moving\" plays: it stops, no win line", v.now === null && v.log.join() === "keepMoving", JSON.stringify(v));
  await wait(4000);
  await page.getByRole("button", { name: /PLAY AGAIN/i }).first().click();
  await page.waitForURL("**/new**"); await wait(1500);
  await page.getByRole("button", { name: "START GAME" }).click().catch(() => undefined);
  for (let i = 0; i < 60 && !(await page.evaluate(() => { const m = window.__outbreak?.getView().match; return !!m && !m.paused && m.elapsedS < 30; })); i++) await wait(400);
  await wait(1000);
  check("a new match after the ended one opens with its line again", (await voices(page)).log.join() === "keepMoving,keepMoving", JSON.stringify(await voices(page)));
  await o.ctx.close();
}

// --- Muted from an earlier visit: nothing at all ---
{
  const o = await open(); const { page, wait } = o;
  await o.ctx.addInitScript(() => { try { localStorage.setItem("outbreak.cues", "off"); } catch {} });
  await page.goto(BASE + "/"); await page.waitForTimeout(800);
  await page.getByRole("link", { name: "NEW GAME" }).click(); await page.waitForURL("**/new"); await wait(2000);
  const mu = await music(page);
  check("saved 'sound off': no music after a tap", !mu.playing && mu.els.every((e) => e.paused), JSON.stringify(mu));
  await o.ctx.close();
}

const real = errors.filter((e) => !/Failed to load resource|favicon|WebGL|swiftshader|GPU stall|tiles\.openfreemap/i.test(e));
check("no console errors", real.length === 0, real.slice(0, 3).join(" | "));
await browser.close();
console.log(`${res.filter(Boolean).length}/${res.length} passed`);
process.exit(res.every(Boolean) ? 0 : 1);
