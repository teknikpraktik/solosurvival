/**
 * Lokala SVG-symboler för kartan (inbäddade i appen: inga bildförfrågningar under matchen, ingen emoji).
 * Storleken anges i CSS-pixlar, så den är densamma oavsett skärmupplösning.
 */

/** Zombieansikte: mörk bakgrundsskiva med ljus ring (läsbar mot både mörk och ljus karta), grönaktigt ansikte, urholkade ögon med glöd, tänder och spricka. */
export const ZOMBIE_SVG = `<svg class="zsvg" viewBox="1.5 1.5 29 29" width="34" height="34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<circle class="zring" cx="16" cy="16" r="15" fill="#0b0f14" stroke="#e9f2d9" stroke-width="1.6"/>
<path d="M16 4.6c6 0 9.4 3.9 9.4 9 0 2.3-.8 4.1-2 5.3v3.3c0 1.2-.8 2-2 2h-1l-.6 1.6h-1.6l-.5-1.6h-3.6l-.5 1.6h-1.6l-.6-1.6h-1c-1.2 0-2-.8-2-2v-3.3c-1.2-1.2-2-3-2-5.3 0-5.1 3.4-9 9.4-9z" fill="#9bb277" stroke="#2a3a1e" stroke-width=".8"/>
<path d="M18.6 5.4l-1.5 3 1.7 1.2-1.4 2.3" fill="none" stroke="#1d2a14" stroke-width=".9" stroke-linecap="round"/>
<ellipse cx="12" cy="13.4" rx="3.1" ry="3.7" fill="#05080b"/>
<ellipse cx="20.2" cy="13" rx="2.6" ry="3.3" fill="#05080b"/>
<circle class="zeye" cx="12.4" cy="13.8" r="1.25" fill="#ffe45c"/>
<circle class="zeye" cx="19.9" cy="13.4" r="1" fill="#ffe45c"/>
<path d="M14.9 17.6l1.1 1.7 1.1-1.7" fill="none" stroke="#05080b" stroke-width="1" stroke-linecap="round"/>
<path d="M10.4 21.3h11.2v2.7l-1.5-.9-1.2 1.3-1.3-1.1-1.3 1.3-1.3-1.1-1.2 1.3-1.4-.9z" fill="#05080b"/>
<path d="M11.8 21.3v1.9M14.2 21.3v2.1M16.6 21.3v2.1M19 21.3v1.9M21 21.3v1.5" stroke="#f3f0df" stroke-width=".95" stroke-linecap="round"/>
</svg>`;

/** Spelarens riktningspil: vit kant med mörk ytterkant (kontrast i dagsljus), spetsen pekar i färdriktningen. */
export const ARROW_SVG = `<svg viewBox="0 0 40 40" width="40" height="40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path d="M20 3 L33 35 L20 28 L7 35 Z" fill="none" stroke="#0b0f14" stroke-width="6" stroke-linejoin="round" opacity=".75"/>
<path d="M20 3 L33 35 L20 28 L7 35 Z" fill="#2f7cff" stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round"/>
</svg>`;

/** Neutral positionsmarkering när ingen tillförlitlig riktning finns. */
export const DOT_SVG = `<svg viewBox="0 0 40 40" width="40" height="40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<circle cx="20" cy="20" r="11" fill="none" stroke="#0b0f14" stroke-width="5" opacity=".75"/>
<circle cx="20" cy="20" r="11" fill="#2f7cff" stroke="#ffffff" stroke-width="2.6"/>
</svg>`;

/** Liten riktningstriangel som visas vid en rörlig zombie (roteras med CSS). */
export const ZOMBIE_DIR_SVG = `<svg viewBox="0 0 14 14" width="18" height="18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7 1 L12.5 12 L7 9.2 L1.5 12 Z" fill="#ff4d4d" stroke="#0b0f14" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

/** Hem (start/hemkomst): hus i blå skiva. Skiljs tydligt från numrerade checkpoints (cirklar) och från extraction (flagga). */
export const HOME_SVG = `<svg viewBox="0 0 40 40" width="42" height="42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<circle cx="20" cy="20" r="18" fill="#1d4ed8" stroke="#ffffff" stroke-width="2.6"/>
<path d="M9.5 20.5 20 11l10.5 9.5" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M13 19.5V29h5.5v-6h3v6H27v-9.5L20 13.5z" fill="#ffffff"/>
</svg>`;

/** Extraction (Survival): helikopter på grön mål-skiva (rotor, hytt med fönster, stjärtbom och stjärtrotor, medar), med texten EXIT i etiketten. */
export const EXTRACTION_SVG = `<svg viewBox="0 0 40 40" width="42" height="42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<circle cx="20" cy="20" r="18" fill="#15803d" stroke="#ffffff" stroke-width="2.6"/>
<path d="M7.5 11.2h21" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
<path d="M17.2 11.2v4" stroke="#ffffff" stroke-width="2"/>
<ellipse cx="16.6" cy="19.8" rx="6.8" ry="5" fill="#ffffff"/>
<path d="M11.4 19.2c0-2 1.3-3.3 3.2-3.3h1.6v4.2h-4.8z" fill="#15803d"/>
<path d="M22.4 18.1l9 .8v1.7l-9 1.2z" fill="#ffffff"/>
<path d="M31.6 15.6v7.6" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
<path d="M13.4 24.5l-.9 3.4M20 24.5l.9 3.4M9.8 28h14.4" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/>
</svg>`;

/**
 * Visare i kartans kant mot nästa mål utanför bild: vit rund bricka med blå ring och måltavla (samma blå som nästa mål), med en liten spets
 * som pekar mot målet (spetsen uppåt, roteras med CSS). Medvetet en annan form än spelarens blå pilspets, så att de inte förväxlas.
 */
export const GOAL_POINTER_SVG = `<svg viewBox="0 0 32 32" width="30" height="30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path d="M16 1.5 L21.2 9.4 A10.4 10.4 0 1 1 10.8 9.4 Z" fill="none" stroke="#0b0f14" stroke-width="3.6" stroke-linejoin="round" opacity=".75"/>
<path d="M16 1.5 L21.2 9.4 A10.4 10.4 0 1 1 10.8 9.4 Z" fill="#2563eb" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
<circle cx="16" cy="18.4" r="6.6" fill="#ffffff"/>
<circle cx="16" cy="18.4" r="3.6" fill="#2563eb"/>
<circle cx="16" cy="18.4" r="1.4" fill="#ffffff"/>
</svg>`;

/** HUD: on foot, a walking person (currentColor, so it follows the pill's text colour). */
export const WALK_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
<circle cx="13.2" cy="4" r="2.1" fill="currentColor" stroke="none"/>
<path d="M12.6 7.6 11 14"/>
<path d="M11 14 8.4 21.2"/>
<path d="M11 14l2.8 3.3.6 4.2"/>
<path d="M8 11.6l4.4-3.6 3.2 3.6"/>
</svg>`;

/** HUD: Bike, a person on a bike (currentColor). */
export const BIKE_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
<circle cx="5.2" cy="17.6" r="3.7" stroke-width="1.7"/>
<circle cx="18.8" cy="17.6" r="3.7" stroke-width="1.7"/>
<path d="M5.2 17.6 9 12h7.2l2.6 5.6M9 12l3.2 5.6L16.2 12M15.4 10.2h1.8" stroke-width="1.5"/>
<circle cx="15.6" cy="3.9" r="2" fill="currentColor" stroke="none"/>
<path d="M14.6 6.6 10.4 11l3.2 2.6-1.4 3.8M14.6 6.6l1.4 3.6" stroke-width="2.1"/>
</svg>`;

/** Mode cards on New game (currentColor). Checkpoints: a flag on a pole. */
export const MODE_CHECKPOINTS_SVG = `<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M5 21V4"/><path d="M5 4.5h11l-2.2 3.8L16 12H5" fill="currentColor" fill-opacity=".25"/>
</svg>`;

/** A to B: a dashed route from a point to a target pin. */
export const MODE_ATOB_SVG = `<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<circle cx="5" cy="18" r="2.2"/><path d="M7.5 17.2c3-1 3.5-4.2 6.5-5.2" stroke-dasharray="2 2.6"/>
<path d="M18 13.5s-3.6-3.6-3.6-6.3a3.6 3.6 0 0 1 7.2 0c0 2.7-3.6 6.3-3.6 6.3z" fill="currentColor" fill-opacity=".25"/><circle cx="18" cy="7.2" r="1.2" fill="currentColor"/>
</svg>`;

/** Survival: a shield. */
export const MODE_SURVIVAL_SVG = `<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M12 2.8 4.5 5.6v5.6c0 4.6 3.1 8.5 7.5 10 4.4-1.5 7.5-5.4 7.5-10V5.6z" fill="currentColor" fill-opacity=".25"/><path d="m8.8 12 2.3 2.3 4.2-4.6"/>
</svg>`;

/** In-game sound button: a speaker with sound waves (on) … */
export const SOUND_ON_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.2 6.5a8 8 0 0 1 0 11"/>
</svg>`;

/** … and the same speaker struck through (off). */
export const SOUND_OFF_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M3 3l18 18"/>
</svg>`;
