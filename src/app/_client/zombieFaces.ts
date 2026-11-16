/**
 * Which face a zombie wears on the map (OUTBREAK, not Mini Outbreak, which draws its own enemies). Presentation only: the face is chosen
 * from the zombie's id, so it stays the same for its whole life and on every render, needs no storage, and draws no random numbers (the
 * engine's simulations stay deterministic). No face has different rules; there is one kind of zombie.
 *
 * The pictures are built by scripts/build-zombie-faces.py (128 px WebP, round, dark background) and cached by the service worker like
 * every /img/ file. The ring and the threat levels are CSS (.zmark .zface in globals.css).
 */

/** In handing-out order: men and women alternate, so zombies that appear one after another look different. */
export const ZOMBIE_FACE_URLS = [1, 2, 3, 4, 5, 6, 7].map((n) => `/img/zombies/zombie-${n}.webp`);

/**
 * The face (index into ZOMBIE_FACE_URLS) for a zombie id. The engine numbers its zombies (`z0`, `z1`, …), so consecutive zombies take
 * consecutive faces and the first seven on the map are all different. Any other id is hashed (FNV-1a), which is just as stable.
 */
export function zombieFace(id: string): number {
  const n = ZOMBIE_FACE_URLS.length;
  const m = /^z(\d+)$/.exec(id);
  if (m) return Number(m[1]) % n;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h % n;
}

/** The marker's face element. No text and no image request per marker: every marker with this face shares one cached picture. */
export const zombieFaceHtml = (id: string): string => {
  const i = zombieFace(id);
  return `<span class="zface" data-face="${i + 1}" style="background-image:url(${ZOMBIE_FACE_URLS[i]})"></span>`;
};

/** Fetch the faces once before they are needed (setup or the start of a match), so the first zombie never appears without one. */
export function preloadZombieFaces(): void {
  if (typeof Image === "undefined") return;
  for (const src of ZOMBIE_FACE_URLS) { const i = new Image(); i.decoding = "async"; i.src = src; }
}
