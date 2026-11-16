# OUTBREAK – Solo Survival

GPS-baserat överlevnadsspel (PWA) där zombier jagar spelaren längs verkliga stigar. Se produktspecifikationen (PRD v1.0).

## Status

Spelbar PWA med fullständigt matchflöde: tre spellägen (Checkpoints, A TO B, Survival), till fots och på cykel, ljudbild med inspelade
radiorepliker, matchhistorik och återuppspelning. Fälttestad (se `docs/FALTTEST-1.md`). Återstår före release: balansering i fält och
beslut om native-skal (bakgrunds-GPS, vibration på iPhone).

## Kampanjer

Huvudmenyn leder till CAMPAIGN (berättelsedrivna uppdrag) och FREE PLAY (de tre fristående lägena, oförändrade). CAMPAIGN består av
stories i kapitel och uppdrag. Första storyn är **REGENESIS** (fem kapitel, se [Story Bible](docs/OUTBREAK_STORY_BIBLE_V2_2.md)); dess
kapitel 1, THE FALL, är spelbart: fem uppdrag till fots på samma motor som Free Play. Arkitektur, balans, röstmanus och fälttestlista finns i
[`docs/CAMPAIGN-THE-FALL.md`](docs/CAMPAIGN-THE-FALL.md). Kod: `src/campaign/`. Verktyg: `npm run campaign:voice` (röstmanus och lista över
inspelade repliker), `npx tsx scripts/campaign-balance.ts` (simulerade vinster per uppdrag och nivå), `npm run e2e:campaign`.

## v2.2 (stabilisering efter fälttest)

Se `docs/V2.2-ANALYS.md` (grundorsaker, avsnitt 5 = slutlig kvalitetssäkring) och `docs/V2.2-RAPPORT.md` (åtgärder, tester, simuleringar, GO/NO-GO; avsnitt 11 = kvalitetssäkringen).

Verktyg för balans och granskning (alla använder samma motor som spelet):
- `npm run balance -- 10 karlstad survival v21,v22` – enkel jämförelse av modeller på riktig data.
- `npx tsx scripts/balance-qa.ts <område> <läge> <modell> <strategier> <svårigheter> <tempon> <N> <ut.jsonl>` + `scripts/balance-qa-report.ts` / `balance-qa-summary.ts` – många matcher, flera spelarstrategier, Wilson-intervall, fångstorsak.
- `scripts/infection-noise.ts` (GPS-brus mot infektionsregeln), `scripts/background-exploit.ts` (regler för frånvaro), `scripts/graph-audit.ts` / `graph-audit-karlstad.ts` (passager mot facit).
- `npm run lint` – `tsc` med `noUnusedLocals/Parameters` (ESLint stöder ännu inte TypeScript 7).

## Kartdata utanför Värmland

Vuxenappen använder det exakta OSM-underlaget i `public/data/v1/varmland` där det räcker och bygger annars stignätet ur OpenFreeMaps
globala vektortiles (`src/data/ofm-store.ts`, `FallbackStore` i `src/data/store.ts`). Mini Outbreak är fortfarande begränsad till
Värmland. Mätningar, brister och plan: [`docs/GLOBAL-MAP-DATA.md`](docs/GLOBAL-MAP-DATA.md).

## Zombie-AI med roller

Förföljare och genskjutare (Free Play i vuxenappen; kampanjen och Mini Outbreak oförändrade). Beteende, informationsregler, parametrar
och jämförelse med tidigare AI: [`docs/ZOMBIE-AI-ROLES.md`](docs/ZOMBIE-AI-ROLES.md). Värden: `src/config/zombie-ai.ts`. Jämförelse:
`npx tsx scripts/ai-compare.ts`.

## Ljud

Ljudbilden i vuxenappen (menymusik, hotpulser, helikopter, händelseljud, tal med radioklick) beskrivs i [`docs/LJUD.md`](docs/LJUD.md). Originalfilerna finns i `assets/audio/source/`, och `node scripts/build-audio.mjs` (kräver ffmpeg) bygger `public/audio/*.mp3`. Ljud-e2e: `BASE_URL=… node e2e/audio.e2e.mjs`.

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
- `src/campaign` – kampanjer: definitioner, framsteg, uppdragsregler, berättelse. Ingen import av React.
- `src/app` – Next.js (startsida, `/campaigns`, `/new`, `/play`, `/history`, `/how-to-play`, `/field`, `/dev`). Inga API-routes. Se `docs/ETAPP-3.md`.

## Beslut och avvikelser från PRD

- `/api/validate-area` tar en valfri `start`-position (PRD 5.3 kräver att startpunkten ligger i området).
- Infektion vid GPS-noggrannhet 10–20 m kräver 5 s i stället för 3 s (PRD 6.3: "ytterligare verifiering"). Detta är ett förslag att fälttesta.
- "Oundviklig infektion" vid spawn (PRD 3.4) är approximerad med nätavstånd ≥ minimiavstånd, inte en fullständig analys av återvändsgränder.
- Zombier hålls i spelarens sammanhängande nätverkskomponent.
- Ingen CSS-ram: all stil ligger i `src/app/globals.css`. Typsnitten (Barlow, Barlow Condensed, SIL OFL) serveras från `public/fonts`.

## Etapp 2.5: kartdata, ruttgenerering och tre spellägen

Experimentell utvecklingskod på branchen `feature/etapp-2.5-routes` (hybridstudien ligger kvar, ej mergad, på `experiment/hybrid-offroad`).

- Rapport och rekommendation: [`docs/ETAPP-2.5.md`](docs/ETAPP-2.5.md)
- Kartdatakällor (OSM-extrakt, Lantmäteriet, Skogsstyrelsen): [`experiments/data/DATA-SOURCES.md`](experiments/data/DATA-SOURCES.md)
- Ruttgenerator: `src/routes/` · målmodell: `src/engine/objectives/` · lägesregler: `src/config/modes.ts` · botar: `src/sim/bots.ts`
- Dev-vy: `npx tsx experiments/routes/export-viz.ts && npm run dev`, öppna `/dev/routes`
- Utvärdering: `npx tsx experiments/routes/eval-routes.ts`, `experiments/routes/run-all.sh`, resultat i `experiments/routes/results-*.md`
