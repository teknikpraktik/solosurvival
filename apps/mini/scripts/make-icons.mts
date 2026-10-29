// Ritar PWA-ikonerna (public/icons) från fiendefigurerna i src/client/enemies.ts. Kör: CHROMIUM_PATH=… npx tsx apps/mini/scripts/make-icons.mts
// TILLFÄLLIGA ikoner tills slutlig grafik levereras.
import { chromium } from "playwright-core";
import { enemyArt } from "../src/client/enemies";
const out = new URL("../public/icons", import.meta.url).pathname;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage();
async function icon(file: string, size: number, maskable: boolean) {
  await p.setViewportSize({ width: size, height: size });
  const s = size / 512;
  // Maskable: everything inside the central 80 % safe zone, full-bleed background.
  const scale = maskable ? 0.78 : 1;
  const radius = maskable ? 0 : 112 * s;
  const big = 300 * s * scale, small = 150 * s * scale;
  const html = `<html><body style="margin:0"><div style="width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden;position:relative;background:radial-gradient(circle at 30% 25%,#b197fc,#7c5cff 55%,#5f3dc4)">
    <div style="position:absolute;left:${(size - big) / 2}px;top:${(size - big) / 2 - 18 * s * scale}px">${enemyArt("rainbow-ghost", "i1", big)}</div>
    <div style="position:absolute;left:${size / 2 - big / 2 - small * 0.35}px;top:${size / 2 + big * 0.12}px">${enemyArt("cute-zombie", "i2", small)}</div>
    <div style="position:absolute;left:${size / 2 + big / 2 - small * 0.65}px;top:${size / 2 + big * 0.12}px">${enemyArt("mini-monster", "i3", small)}</div>
  </div></body></html>`;
  await p.setContent(html);
  await p.screenshot({ path: `${out}/${file}`, omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } });
}
await icon("icon-192.png", 192, false);
await icon("icon-512.png", 512, false);
await icon("icon-maskable-512.png", 512, true);
// Apple: square, iOS rounds the corners itself.
await p.setViewportSize({ width: 180, height: 180 });
await icon("apple-touch-icon.png", 180, true);
await b.close();
