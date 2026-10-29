// Ritar PWA-ikonerna (public/icons) från fiendefigurerna i src/client/enemies.ts. Kör: CHROMIUM_PATH=… npx tsx apps/mini/scripts/make-icons.mts
// TILLFÄLLIGA ikoner tills slutlig grafik levereras.
// Motiv: ett enda Rainbow Ghost, kraftigt inzoomat på ansiktet (ögon, kinder, leende). Bakgrunden är spökets egen pastellregnbåge,
// så att ansiktet fyller hela ikonen; kroppens kontur tas bort eftersom kroppen är större än bilden.
import { chromium } from "playwright-core";
import { enemyArt } from "../src/client/enemies";
const out = new URL("../public/icons", import.meta.url).pathname;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage();

/** Samma pastellregnbåge som spökets kropp (se enemies.ts), uppifrån och ned. */
const RAINBOW = "linear-gradient(#ffc2d4 -18%, #ffdcb0 14%, #fdffc0 40%, #cdf7c6 65%, #b5ecff 87%, #cdbfff 110%)";

/** Spökets ansikte med en given utsnittsruta (i figurens koordinater, 0–40). */
function face(size: number, view: string): string {
  const body = /fill="url\(#gh-icon\)" stroke="#9b8fe0" stroke-width="1.1"/;
  const svg = enemyArt("rainbow-ghost", "icon", size);
  if (!body.test(svg)) throw new Error("rainbow-ghost body changed: update make-icons.mts");
  return svg.replace(body, 'fill="none" stroke="none"').replace(/viewBox="[^"]*"/, `viewBox="${view}"`); // kroppen = bakgrunden
}

// "any" och Apple: tätt utsnitt runt ögon och leende. Maskable: något vidare, så att ögonen ryms i den centrala säkra zonen (80 %).
const TIGHT = "10.5 10 19 19";
const MASKABLE = "8.6 8.2 22.8 22.8";

async function icon(file: string, size: number, view: string, radius: number) {
  await p.setViewportSize({ width: size, height: size });
  const html = `<html><body style="margin:0"><div style="width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden;background:${RAINBOW}">${face(size, view)}</div></body></html>`;
  await p.setContent(html);
  await p.screenshot({ path: `${out}/${file}`, omitBackground: radius > 0, clip: { x: 0, y: 0, width: size, height: size } });
}
await icon("icon-192.png", 192, TIGHT, 42);
await icon("icon-512.png", 512, TIGHT, 112);
await icon("icon-maskable-512.png", 512, MASKABLE, 0);
// Apple: kvadratisk, iOS rundar hörnen själv.
await icon("apple-touch-icon.png", 180, TIGHT, 0);
await b.close();
