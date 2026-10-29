// Ritar PWA-ikonerna (public/icons). Kör: CHROMIUM_PATH=… npx tsx apps/mini/scripts/make-icons.mts
// Motiv i samma anda som startbilden (public/brand/splash.*) men förenklat för hemskärmen: nattblå himmel, stor fullmåne och ett vitt,
// glödande spöke med öppet leende. Ingen text och inga små detaljer (fladdermöss, gravstenar) som inte syns i 60 px.
import { chromium } from "playwright-core";
const out = new URL("../public/icons", import.meta.url).pathname;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage();

/** Spöket i egna koordinater (52 × 57): rundat huvud, vågig nederkant, små armar, stora ögon, öppen mun med tunga. */
const GHOST_BODY = "M26 0C40.4 0 50 10.5 50 25V52q-4 5-8 0q-4-5-8 0q-4 5-8 0q-4-5-8 0q-4 5-8 0q-4-5-8 0V25C2 10.5 11.6 0 26 0Z";
const ghost = `
  <g filter="url(#glow)"><path d="${GHOST_BODY}" fill="#9fd0ff"/><ellipse cx="2" cy="33" rx="6.5" ry="4.2" transform="rotate(-28 2 33)" fill="#9fd0ff"/><ellipse cx="50" cy="31" rx="6.5" ry="4.2" transform="rotate(28 50 31)" fill="#9fd0ff"/></g>
  <ellipse cx="2" cy="33" rx="6.5" ry="4.2" transform="rotate(-28 2 33)" fill="url(#body)"/>
  <ellipse cx="50" cy="31" rx="6.5" ry="4.2" transform="rotate(28 50 31)" fill="url(#body)"/>
  <path d="${GHOST_BODY}" fill="url(#body)"/>
  <ellipse cx="18" cy="23" rx="4.4" ry="5.6" fill="#1b2340"/><ellipse cx="34" cy="23" rx="4.4" ry="5.6" fill="#1b2340"/>
  <circle cx="19.6" cy="20.8" r="1.6" fill="#fff"/><circle cx="35.6" cy="20.8" r="1.6" fill="#fff"/>
  <ellipse cx="12.4" cy="31" rx="3" ry="1.8" fill="#ff9ec0" opacity=".55"/><ellipse cx="39.6" cy="31" rx="3" ry="1.8" fill="#ff9ec0" opacity=".55"/>
  <path d="M19.5 31.5Q26 42.5 32.5 31.5Z" fill="#4a1d3a"/><ellipse cx="26" cy="36" rx="3.2" ry="1.9" fill="#ff7aa2"/>`;

/** Hela motivet i 100 × 100. `inset` krymper motivet (inte himlen) mot mitten, för maskable-ikonens säkra zon. */
function scene(size: number, inset: number): string {
  const k = (100 - 2 * inset) / 100;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="sky" cx="66%" cy="32%" r="80%"><stop offset="0" stop-color="#1f5a96"/><stop offset=".45" stop-color="#0d2a52"/><stop offset="1" stop-color="#06122a"/></radialGradient>
    <radialGradient id="moonglow"><stop offset=".55" stop-color="#fff1c1" stop-opacity=".45"/><stop offset="1" stop-color="#fff1c1" stop-opacity="0"/></radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".75" stop-color="#eef5ff"/><stop offset="1" stop-color="#c9defa"/></linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>
  </defs>
  <rect width="100" height="100" fill="url(#sky)"/>
  <g transform="translate(${inset} ${inset}) scale(${k})">
    <circle cx="68" cy="33" r="34" fill="url(#moonglow)"/>
    <circle cx="68" cy="33" r="23" fill="#fff1c1"/>
    <circle cx="60" cy="27" r="4.5" fill="#f2dc9c" opacity=".55"/><circle cx="75" cy="40" r="6" fill="#f2dc9c" opacity=".45"/><circle cx="73" cy="23" r="2.6" fill="#f2dc9c" opacity=".5"/>
    <circle cx="14" cy="16" r=".9" fill="#cfe6ff"/><circle cx="30" cy="9" r=".7" fill="#cfe6ff"/><circle cx="8" cy="40" r=".7" fill="#cfe6ff"/>
    <g transform="translate(16 31)">${ghost}</g>
  </g>
</svg>`;
}

async function icon(file: string, size: number, inset: number, radius: number) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0"><div style="width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden;line-height:0">${scene(size, inset)}</div></body></html>`);
  await p.screenshot({ path: `${out}/${file}`, omitBackground: radius > 0, clip: { x: 0, y: 0, width: size, height: size } });
}
await icon("icon-192.png", 192, 0, 42);
await icon("icon-512.png", 512, 0, 112);
// Maskable: motivet inom den centrala säkra zonen (80 %), himlen fyller ut till kanterna.
await icon("icon-maskable-512.png", 512, 10, 0);
// Apple: kvadratisk, iOS rundar hörnen själv.
await icon("apple-touch-icon.png", 180, 0, 0);
await b.close();
