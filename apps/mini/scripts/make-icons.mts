// Ritar PWA-ikonerna (public/icons). Kör: CHROMIUM_PATH=… npx tsx apps/mini/scripts/make-icons.mts
// Motiv: den levererade zombiefiguren (assets/icon-zombie.png, beskuren och med rensad alfakanal) på samma nattblå himmel som startbilden
// (public/brand/splash.*). Figuren fyller ikonen; i maskable-varianten ligger den inom den säkra zonen.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
const out = new URL("../public/icons", import.meta.url).pathname;
const art = `data:image/png;base64,${readFileSync(new URL("../assets/icon-zombie.png", import.meta.url)).toString("base64")}`;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage();

const SKY = "radial-gradient(circle at 50% 38%, #1f5a96 0, #0d2a52 48%, #06122a 100%)";

/** `fill`: hur stor del av ikonens bredd figuren får ta (figuren är bredare än hög och centreras, lite högre upp för huvudets skull). */
async function icon(file: string, size: number, fill: number, radius: number) {
  await p.setViewportSize({ width: size, height: size });
  const w = size * fill;
  await p.setContent(`<html><body style="margin:0"><div style="position:relative;width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden;background:${SKY}">
    <img src="${art}" style="position:absolute;width:${w}px;left:${(size - w) / 2}px;top:50%;transform:translateY(-52%);filter:drop-shadow(0 ${size * 0.012}px ${size * 0.02}px #000a)">
  </div></body></html>`);
  await p.waitForFunction(() => document.querySelector("img")?.complete);
  await p.screenshot({ path: `${out}/${file}`, omitBackground: radius > 0, clip: { x: 0, y: 0, width: size, height: size } });
}
await icon("icon-192.png", 192, 0.92, 42);
await icon("icon-512.png", 512, 0.92, 112);
// Maskable: Android beskär till olika former; hela figuren inom den centrala säkra zonen (cirkel med 80 % diameter).
await icon("icon-maskable-512.png", 512, 0.72, 0);
// Apple: kvadratisk, iOS rundar hörnen själv (lite marginal så att håret och händerna inte klipps i hörnen).
await icon("apple-touch-icon.png", 180, 0.88, 0);
await b.close();
