// Ritar PWA-ikonerna (public/icons) från fiendefigurerna i src/client/enemies.ts. Kör: CHROMIUM_PATH=… npx tsx apps/mini/scripts/make-icons.mts
// TILLFÄLLIGA ikoner tills slutlig grafik levereras.
// Motiv: ett enda Cute Mini Monster, kraftigt inzoomat på ansiktet (ögon, kinder, leende). Bakgrunden är monstrets egen orange färg,
// så att ansiktet fyller hela ikonen; kroppens kontur tas bort eftersom kroppen är större än bilden.
import { chromium } from "playwright-core";
import { enemyArt } from "../src/client/enemies";
const out = new URL("../public/icons", import.meta.url).pathname;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage();

/** Monstrets ansikte med en given utsnittsruta (i figurens koordinater, 0–40). */
function face(size: number, view: string): string {
  const svg = enemyArt("mini-monster", "icon", size)
    .replace('fill="#ffa94d" stroke="#e8590c" stroke-width="1.2"', 'fill="none" stroke="none"') // kroppen = bakgrunden
    .replace(/<ellipse [^>]*fill="#e8590c"\/>/g, "") // fötterna (syns annars som fläckar i nederkanten)
    .replace(/viewBox="[^"]*"/, `viewBox="${view}"`);
  if (svg.includes('fill="#ffa94d" stroke="#e8590c"')) throw new Error("mini-monster body changed: update make-icons.mts");
  return svg;
}

// "any" och Apple: tätt utsnitt runt ögon och leende. Maskable: något vidare, så att ögonen ryms i den centrala säkra zonen (80 %).
const TIGHT = "10.25 10.5 19.5 19.5";
const MASKABLE = "8.2 8.6 23.6 23.6";

async function icon(file: string, size: number, view: string, radius: number) {
  await p.setViewportSize({ width: size, height: size });
  const html = `<html><body style="margin:0"><div style="width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden;background:radial-gradient(circle at 34% 26%,#ffd8a8 0,#ffa94d 46%,#f76707 100%)">${face(size, view)}</div></body></html>`;
  await p.setContent(html);
  await p.screenshot({ path: `${out}/${file}`, omitBackground: radius > 0, clip: { x: 0, y: 0, width: size, height: size } });
}
await icon("icon-192.png", 192, TIGHT, 42);
await icon("icon-512.png", 512, TIGHT, 112);
await icon("icon-maskable-512.png", 512, MASKABLE, 0);
// Apple: kvadratisk, iOS rundar hörnen själv.
await icon("apple-touch-icon.png", 180, TIGHT, 0);
await b.close();
