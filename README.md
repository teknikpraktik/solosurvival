# OUTBREAK – Solo Survival

GPS-baserat överlevnadsspel (PWA) där zombier jagar spelaren längs verkliga stigar. Se produktspecifikationen (PRD v1.0).

## Status: etapp 0–2 (simulerbar prototyp)

| Etapp | Innehåll | Status |
| --- | --- | --- |
| 0 | Next.js, MapLibre, GPS-filter, motorgränssnitt, Vitest | Klar. Ingen riktig GPS-källa i UI ännu |
| 1 | OSM → graf, validering, komponenter, A\* | Klar mot fixturer. Overpass är inte testat live |
| 2 | Zombie-AI, spawn, infektion, extraction, determinism | Klar och testad i simulering |
| 3–5 | Fullständigt matchflöde, UX/lagring, balansering, release | Ej påbörjad |

## Kommandon

```bash
npm install          # kopierar även MapLibre-workern till public/maplibre
npm run dev          # http://localhost:3000/dev = simulerad match på karta
npm test             # enhets- och simuleringstester (Vitest)
npm run typecheck
npm run sim -- 20 24 # balanseringssimulering: matcher per cell, rutnätsstorlek
```

## Struktur

- `src/engine` – ren TypeScript, ingen import av React/MapLibre/Next. Körs i Node.
- `src/geo` – geometri, stiggraf, OSM-normalisering/filtrering, områdesvalidering.
- `src/gps` – GPS-filter och map matching.
- `src/sim` – syntetiska nät, simulerad spelare och strategier (används av tester, CLI och `/dev`).
- `src/app` – Next.js (startsida, `/dev`, `/api/terrain`, `/api/validate-area`).

## Beslut och avvikelser från PRD

- Matchtiden inkluderar försprånget; zombier står stilla under det.
- `/api/validate-area` tar en valfri `start`-position (PRD 5.3 kräver att startpunkten ligger i området).
- Infektion vid GPS-noggrannhet 10–20 m kräver 5 s i stället för 3 s (PRD 6.3: "ytterligare verifiering"). Detta är ett förslag att fälttesta.
- "Oundviklig infektion" vid spawn (PRD 3.4) är approximerad med nätavstånd ≥ minimiavstånd, inte en fullständig analys av återvändsgränder.
- Zombier hålls i spelarens sammanhängande nätverkskomponent.
- Tailwind är inte installerat än; UI:t är minimal CSS tills etapp 4.
- Utan `NEXT_PUBLIC_MAP_STYLE` ritas bara stignätet på mörk bakgrund. En kartleverantör med lämpliga villkor måste väljas före release.

## Hybrid-AI-studie (experimentgren)

Branchen `experiment/hybrid-offroad` innehåller en undersökning av om zombier ska få röra sig långsamt genom terräng utöver stigarna, gjord på verkliga OSM-data från Karlstad (Skutberget, I2-skogen, Sörmon).

- Rapport och rekommendation: [`experiments/hybrid/REPORT.md`](experiments/hybrid/REPORT.md)
- Fixturer med källa och licens: [`experiments/hybrid/fixtures/README.md`](experiments/hybrid/fixtures/README.md)
- Visualisering: `npx tsx experiments/hybrid/export-viz.ts && npm run dev`, öppna `/dev/hybrid`

Produktionskoden har bara fått neutrala hakar (kantattribut `offroad`/`speedFactor`, `trailOf()`-vy, kedjeregel i A\*). Stigbundna grafer ger bit-identiska resultat mot `main`.
