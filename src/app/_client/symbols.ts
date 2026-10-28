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

/** Extraction (Survival): flagga på mål-skiva i grönt, med texten EXIT i etiketten. */
export const EXTRACTION_SVG = `<svg viewBox="0 0 40 40" width="42" height="42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<circle cx="20" cy="20" r="18" fill="#15803d" stroke="#ffffff" stroke-width="2.6"/>
<path d="M14 30V10" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round"/>
<path d="M14.5 11h13l-3.6 4.6 3.6 4.6h-13z" fill="#ffffff"/>
</svg>`;

/** Pil i kartans kant mot nästa mål utanför bild: liten blå vinkel (samma färg som nästa mål) med mörk kontur, spetsen uppåt (roteras med CSS). */
export const GOAL_POINTER_SVG = `<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path d="M12 3 L21 19 L12 15 L3 19 Z" fill="none" stroke="#0b0f14" stroke-width="4" stroke-linejoin="round" opacity=".75"/>
<path d="M12 3 L21 19 L12 15 L3 19 Z" fill="#2563eb" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;
