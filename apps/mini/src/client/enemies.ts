import { ENEMY_KINDS, type EnemyKind } from "../config/product";

/**
 * Mini Outbreaks fiender: fyra söta typer som blandas i varje match. Typen är bara utseende och räknas fram ur fiendens id
 * (motorn numrerar fiender z0, z1, z2 … när de skapas), så den bestäms när fienden skapas, är densamma efter en återställning och
 * påverkar aldrig AI, fart eller regler. Ordningen roteras per match, så alla fyra typer kommer i tur och ordning och fördelningen
 * över tid blir jämn.
 *
 * TILLFÄLLIG GRAFIK: enkla SVG-figurer ritade för att appen ska fungera. Slutliga illustrationer levereras separat (se apps/mini/README.md).
 */

export const ENEMY_LABEL: Record<EnemyKind, string> = {
  "cute-zombie": "Cute Zombie",
  "rainbow-ghost": "Rainbow Ghost",
  "rainbow-spider": "Rainbow Spider",
  "mini-monster": "Cute Mini Monster",
};

/** FNV-1a (32 bit): stabil, beroendefri hash för strängar. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Fiendens visuella typ. `matchId` roterar ordningen så att varje match inte börjar med samma typ. */
export function enemyKind(enemyId: string, matchId = ""): EnemyKind {
  const m = /^z(\d+)$/.exec(enemyId);
  const n = m ? Number(m[1]) : hash(enemyId);
  return ENEMY_KINDS[(n + hash(matchId)) % ENEMY_KINDS.length];
}

const RING: Record<EnemyKind, string> = { "cute-zombie": "#22c55e", "rainbow-ghost": "#a78bfa", "rainbow-spider": "#f472b6", "mini-monster": "#fb923c" };
const RAINBOW = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#4dabf7", "#9775fa", "#f783ac", "#63e6be"];

const eyes = (lx: number, rx: number, y: number, r: number) =>
  [lx, rx].map((x) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#2d2a4a" stroke-width=".7"/><circle cx="${x + r * 0.15}" cy="${y + r * 0.2}" r="${r * 0.52}" fill="#2d2a4a"/><circle cx="${x + r * 0.35}" cy="${y - r * 0.12}" r="${r * 0.22}" fill="#fff"/>`).join("");
const cheeks = (lx: number, rx: number, y: number) => `<ellipse cx="${lx}" cy="${y}" rx="1.7" ry="1.1" fill="#ff8fab" opacity=".75"/><ellipse cx="${rx}" cy="${y}" rx="1.7" ry="1.1" fill="#ff8fab" opacity=".75"/>`;
const smile = (x: number, y: number, w: number) => `<path d="M${x - w / 2} ${y}q${w / 2} ${w * 0.45} ${w} 0" fill="none" stroke="#2d2a4a" stroke-width="1.3" stroke-linecap="round"/>`;

/** Figuren utan bakgrundsskiva (viewBox 0 0 40 40). `id` gör gradient-id:n unika i dokumentet (bara tecken som är giltiga i ett id). */
function figure(kind: EnemyKind, id: string): string {
  const uid = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  switch (kind) {
    case "cute-zombie":
      return `<rect x="9" y="9" width="22" height="22" rx="10" fill="#a3e38f" stroke="#3f8f3a" stroke-width="1.2"/>`
        + `<path d="M18.5 9.4c-.2-1.9.9-3.1 2.4-3.3-.5.9 0 1.8.9 2.3" fill="none" stroke="#3f8f3a" stroke-width="1.3" stroke-linecap="round"/>`
        + `<rect x="22.5" y="10.6" width="6" height="2.4" rx="1.2" fill="#ffd8a8" stroke="#e8a87c" stroke-width=".5" transform="rotate(18 25.5 11.8)"/>`
        + eyes(15.6, 24.4, 18.4, 3.6) + cheeks(12.6, 27.4, 23.4) + smile(20, 24.6, 5.6);
    case "rainbow-ghost":
      return `<defs><linearGradient id="gh-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc2d4"/><stop offset=".25" stop-color="#ffdcb0"/><stop offset=".45" stop-color="#fdffc0"/><stop offset=".65" stop-color="#cdf7c6"/><stop offset=".82" stop-color="#b5ecff"/><stop offset="1" stop-color="#cdbfff"/></linearGradient></defs>`
        + `<path d="M20 6.5c-6.6 0-11 4.8-11 11.2v13.6c0 .9 1 1.3 1.7.7l2.3-2 2.4 2.2c.5.4 1.1.4 1.5 0l2.4-2.3c.4-.4 1-.4 1.4 0l2.4 2.3c.4.4 1 .4 1.5 0l2.4-2.2 2.3 2c.7.6 1.7.2 1.7-.7V17.7c0-6.4-4.4-11.2-11-11.2z" fill="url(#gh-${uid})" stroke="#9b8fe0" stroke-width="1.1"/>`
        + eyes(16, 24, 17.6, 3.2) + cheeks(12.9, 27.1, 22.2) + smile(20, 23.2, 4.4);
    case "rainbow-spider": {
      const left = ["M13.6 16.8Q8.2 12.6 5 15.6", "M12.8 19.8Q7 17.8 4.2 20.8", "M12.8 23Q7 23.2 4.8 26.6", "M14 26Q9.4 28.4 7.6 32"];
      const right = left.map((d) => d.replace(/(\d+(?:\.\d+)?)\s(\d+(?:\.\d+)?)/g, (_s, x: string, y: string) => `${(40 - Number(x)).toFixed(1)} ${y}`));
      const legs = [...left, ...right].map((d, i) => `<path d="${d}" fill="none" stroke="${RAINBOW[i]}" stroke-width="2.2" stroke-linecap="round"/>`).join("");
      return `<defs><linearGradient id="sp-${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8787"/><stop offset=".22" stop-color="#ffc078"/><stop offset=".42" stop-color="#ffe066"/><stop offset=".6" stop-color="#8ce99a"/><stop offset=".8" stop-color="#74c0fc"/><stop offset="1" stop-color="#b197fc"/></linearGradient></defs>`
        + legs + `<circle cx="20" cy="21" r="9.2" fill="url(#sp-${uid})" stroke="#7c5cc4" stroke-width="1.1"/>`
        + eyes(16.5, 23.5, 19.4, 3.3) + cheeks(13.8, 26.2, 24) + smile(20, 25, 4.8);
    }
    case "mini-monster":
      return `<path d="M20 8c7.1 0 11.5 5 11.5 12.2 0 6.8-4.6 11.3-11.5 11.3S8.5 27 8.5 20.2C8.5 13 12.9 8 20 8z" fill="#ffa94d" stroke="#e8590c" stroke-width="1.2"/>`
        + `<ellipse cx="20" cy="25.4" rx="6.2" ry="4.4" fill="#ffe8cc"/>`
        + `<ellipse cx="15.8" cy="31.6" rx="2.6" ry="1.4" fill="#e8590c"/><ellipse cx="24.2" cy="31.6" rx="2.6" ry="1.4" fill="#e8590c"/>`
        + eyes(15.4, 24.6, 17, 3.9) + cheeks(11.8, 28.2, 21.6) + smile(20, 22.4, 6.4);
  }
}

/** Kartmarkör: figuren på en ljus skiva med färgad ring (`zring`, som byter färg när fienden jagar). */
export function enemySvg(kind: EnemyKind, uid: string, size = 38): string {
  return `<svg class="zsvg" data-kind="${kind}" viewBox="0 0 40 40" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<circle class="zring" cx="20" cy="20" r="19" fill="#fffaf0" stroke="${RING[kind]}" stroke-width="2.2"/>${figure(kind, uid)}</svg>`;
}

/** Figuren utan skiva, för illustrationer. */
export function enemyArt(kind: EnemyKind, uid: string, size: number): string {
  return `<svg data-kind="${kind}" viewBox="2 4 36 32" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${figure(kind, uid)}</svg>`;
}

/** Markör för en fiende i en viss match (för GameMap.enemySvg). */
export const enemyMarker = (matchId: string) => (enemyId: string): string => enemySvg(enemyKind(enemyId, matchId), `${matchId}-${enemyId}`);
