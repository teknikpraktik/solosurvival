# Etapp 2.5: svenska kartdata, ruttgenerering och tre spellägen

Branch: `feature/etapp-2.5-routes` (från `master`; hybrid-experimentet ligger kvar på `experiment/hybrid-offroad` och är **inte** mergat). Datum: 2026-10-17. Status: experimentell utvecklingskod, ingen produktionsmerge, inget driftsatt.

## Sammanfattning

| Fråga | Kort svar |
|---|---|
| 1. Bäst stigunderlag? | **OSM (regionalt länsextrakt).** Det är den enda källa jag kunde mäta. Lantmäteriets Topografi 10/50 kräver Geotorget-inloggning (HTTP 401) och kunde inte hämtas, så OSM-mot-Lantmäteriet är *dokumentbaserad, inte uppmätt*. Enligt dokumentationen är T50 generaliserad och olämplig för stigar; T10 är potentiellt ett bra komplement |
| 2. Rimligt att kombinera OSM och LM? | Tekniskt ja med strikta regler (avsnitt 2). Juridiskt sannolikt för T50 (CC0) men **oklart för T10** (annat villkor, inte CC0). Bygg ingen kombination före juridisk granskning och en uppmätt jämförelse |
| 3. A→B-rutter | Bra: 100 % giltiga och inom ±10 % för promenad ≤ 3 km, löpning ≤ 5 km och MTB 5 km i alla tre områden (medelavvikelse 0,3–2,5 %). Fungerar upp till 8 km löpning och 10 km MTB där nätet räcker. Svagare i glesa nät (Skutberget vid Vänern). Tre olika förslag i 77–100 % av fallen vid ≤ 5 km |
| 4. A→A-rutter | Mycket bra: 97–100 % giltiga, medelavvikelse 1,9–4,2 % (7,3 % värst), 53–100 % av förslagen är riktiga slingor (≥ 3 km: 82–100 %), upprepade segment 6–28 %, återvändsgrenar 1–4 % |
| 5. Balans med checkpoints? | **Antalet checkpoints (1–3) ändrar inte vinstfrekvensen** vid fast ruttlängd. Det som styr svårigheten är svårighetsgrad, aktivitet, ruttlängd/tid och bottens förmåga att vika av. Att undvika djupa återvändsgrenar gav ingen mätbar balanseffekt men tar bort uppenbart dålig uppdragsdesign |
| 6. Kvarstående problem | Se avsnitt 6 |
| 7. Minsta implementation för etapp 3 | Se avsnitt 7 |

## 1. Del A: kartdata (se `experiments/data/DATA-SOURCES.md`)

**Inventering:** aktiv branch vid start `experiment/hybrid-offroad`; etapp 0–2 (`7d6a6d9`) och experimentcommits finns; `REPORT.md` och `results/tables.md` finns. **Git remote saknas** och `gh`-token är ogiltig (rapporteras, ändrades inte). Återanvänt: `TrailGraph`/`indexGraph`, OSM-filtret `decideWay`, A\* `planRoute` (med per-kant-hastighet som kostnadskrok), `networkDistances`, simuleringsmotorn och GPS-skydden.

**Vad som mättes:** ett regionalt OSM-extrakt (`download.openstreetmap.fr`, Värmland, 39 MB, md5 verifierad) ger **identiska** stignät som de API-tiles hybridstudien använde: samma ways, kanter, korsningar och komponenter, 100,00 % geometrisk täckning åt båda håll inom 10 m. Extraktion av länet tog 25,7 s. Det löser även problemet med ofullständiga multipolygon-relationer och Overpass-beroendet (nio publika instanser var otillgängliga). Nyckeltal, attributtäckning och användbarhet per område: `DATA-SOURCES.md`.

**Vad som inte gick:** Lantmäteriets Topografi 10/50 och öppna Marktäcke/Byggnader (STAC-metadata öppen, filerna kräver inloggning); Geofabrik (blockerad här, `openstreetmap.fr` fungerade); Skogsstyrelsens sida (403). Jag har inte försökt kringgå autentisering. Punkterna 5–7 och 9 i uppdraget (stigar som bara finns i en källa, geometri- och anslutningsskillnader, hinder) är därför **inte besvarade med data**. Läsare, projektion, jämförelsemodul och skript för att göra detta när en GeoPackage finns är byggda och testade (`compare-lm.ts`, `lib/gpkg.ts`).

**Intressanta dokumentationsfynd (ej mätta):** T50 redovisar gångstig bara om den leder till bebyggelse (≥ 100 m), ett specifikt mål (≥ 250 m), binder samman vägar eller följer strand, och är automatiskt generaliserad ur T10. Ingen av LM-produkterna har tillträdes- eller cykelattribut (OSM har `bicycle`/`mtb:scale`, dock glest: `access`/`foot`/`bicycle` på 0–18 % av ways). LM har däremot `vagutforande` (bro/tunnel/underfart) och en dokumenterad lägesosäkerhet (gångstig 10 m, cykelväg 2 m).

## 2. Är kombination OSM + Lantmäteriet rimlig?

**Tekniskt:** ja, men *inte* som automatisk sammanslagning. Regler (detaljer i `DATA-SOURCES.md` avsnitt 5): OSM är primär; ursprung och licens per kant; dubbletter via toleransmatchning (≈ 12 m); LM-segment läggs bara till om båda ändar ansluter till OSM-nätet och märks `unverified` (aldrig checkpoint/destination); korsningar utan gemensam ändpunkt blir aldrig förbindelser (broar); ingen OSM-kant raderas; tillträde bara från OSM.

**Juridiskt (ej rådgivning):** T50 är CC0 och förenligt med ODbL. T10 har andra villkor ("värdefulla datamängder som innehåller personuppgifter") som måste läsas. Ett kombinerat dataset blir en härledd ODbL-databas med share-alike och attributionskrav.

**Rekommendation:** OSM ensam i v1. Beställ T10 för Värmland, läs villkoren och kör `compare-lm.ts` innan något beslut om kombination.

## 3. Del B: arkitektur

Befintlig stack bibehålls (Next.js, TypeScript, MapLibre, lokal motor, IndexedDB, Vercel, ingen extern databas, ingen routingtjänst). Modulerna är skilda:

| Ansvar | Plats | Anmärkning |
|---|---|---|
| Geografiska datakällor | `experiments/data/` (PBF-extraktion, fixturer, LM-läsare), `src/geo/osm` | Python-extraktion är ett offlinesteg, inte körtid |
| Grafgenerering | `src/geo/graph` | Oförändrad |
| Graf-/källjämförelse | `src/geo/compare` | Ny, tolerans och topologimått, redo för LM |
| Ruttgenerering | `src/routes/` | **Ny, fristående** (inga beroenden på UI/motorns tillstånd; använder bara grafen, A\* och nätavstånd) |
| Uppdragsregler | `src/engine/objectives/`, `src/config/modes.ts` | **Ny gemensam målmodell** |
| Zombie-AI | `src/engine/ai` | **Oförändrad.** Ett test säkerställer att AI-, rörelse- och infektionskoden inte läser `objectives` |
| GPS | `src/gps` | Oförändrad; målbekräftelsen använder samma kvalitetsnivåer som extraction |
| Visualisering | `src/app/dev/routes` | Utvecklarvy, påverkar inte den ordinarie appen |

**En motor för tre lägen.** Survival, Escape och Mission delar `createGame`/`stepGame`/`SimSession`. Skillnaden är bara mål och vinstvillkor:

- **Survival:** oförändrat (extraction öppnar vid 80 %); `resolveModeRules("survival", …)` är identisk med `resolveRules` (testat).
- **Escape/Mission:** `ObjectiveSet` med ordnade mål (destination, checkpoints, hemkomst). Bekräftelse: 30 m radie, 5 s, endast `ok`/`verify`-GPS, ordningen tvingas (att stå hemma vid start räknas inte före checkpoints). Ingen extraction (`extractionOpensAtS = ∞`); tidsgränsen ersätter matchtiden. Zombier spawnar aldrig inom 150 m från mål.
- **Tidsgräns:** `estimateTimeLimitS` = ruttlängd i lugn fart (60 % av aktivitetens nominella) × marginal (1,4/1,25/1,1 för Lätt/Normal/Svår) + 2 min + 10 s per mål. Ingen bonus för snabbhet: vinst beror bara på att målet nås. 5 km löpning på Svår ger > 30 min.
- **Zombier vet inget om rutten:** de får bara de observationer som befintlig AI redan tillåter.

## 4. Ruttgeneratorn (`src/routes/`)

- **Escape (A→B):** kandidater är noder vars kortaste väg ligger inom ±10 % av önskad längd, filtrerade (ej spets/djup återvändsgren, ej farlig korsning), spridda åt olika håll. Om för få destinationer finns på rätt avstånd genereras **via-rutter**: start → via-punkt → destination med straff på redan använda kanter, så att längd kan nås även bortom kortaste väg (utan detta var 8 km löpning och 10 km MTB nästan omöjligt i 3 × 3 km-rutorna: 0–27 % giltiga; med: 87–100 % för löpning 8 km).
- **Mission (A→A):** slumpade checkpoint-uppsättningar (1–3), ordnade runt startpunkten; varje avsnitt planeras med A\* där redan använda kanter får straff, så att slingor uppstår. Ut-och-tillbaka-varianter genereras också och väljs bara om slingor saknas. Slingor rankas före ut-och-tillbaka.
- **Kvalitetsbedömning utan kännedom om zombier:** avvikelse från längd, andel i återvändsgrenar, målpunktens djup i återvändsgren (> 60 m straffas), antal utgångar ur huvudnätet, korsningar med större väg, antal vägval, alternativ väg (A→B), upprepning och ut-och-tillbaka (A→A). Resultatet är en poäng 0–100 med förklarande flaggor.
- **Farliga passager:** större vägar (tertiary och uppåt) filtreras redan bort; korsningspunkter där en tillåten stig delar nod med en sådan väg flaggas (3–24 per område) och undviks som målpunkter och straffas i bedömningen.
- **Tester:** 13 tester för ruttgeneratorn och 9 för målmodellen/motorintegrationen (geometri måste stämma med rapporterad längd, sammanhängande kantföljd, slingor, hemkomst sist, minavstånd, determinism, farliga korsningar, tidsgräns).

## 5. Resultat (verkliga OSM-nät, Skutberget/I2-skogen/Sörmon)

Fullständiga tabeller: `experiments/routes/results-routes.md`, `results-modes.md`. Allt är simuleringar med bottar (se begränsningar).

### Ruttkvalitet (30 slumpade startpunkter per cell)

| | Escape (A→B) | Mission (A→A) |
|---|---|---|
| Giltig (≥ 1 förslag) | 100 % för promenad ≤ 3 km, löpning ≤ 5 km, MTB 5 km; 97–100 % löpning 8 km (I2, Sörmon), 87 % Skutberget; MTB 10 km: I2 100 %, Sörmon 47 %, Skutberget 27 %; MTB 15 km: 0–3 % | 97–100 % (97 % bara promenad 1,5 km) |
| Bäst inom ±10 % | 100 % (≤ 5 km); löpning 8 km 73–100 %; MTB 10 km 17–93 % | 93–100 %; MTB 15 km 87–100 % |
| Tre förslag | 77–100 % (≤ 5 km); sämre i glest nät (löpning 8 km Sörmon 40 %, Skutberget 13 %) | 80–100 % (≥ 3 km: 90–100 %) |
| Medel \|avvikelse\| bästa förslag | 0,3–2,5 % (≤ 5 km) | 1,9–4,2 % (MTB 15 km Skutberget 7,3 %) |
| Slingor | – | 63–100 % av förslagen (≥ 3 km: 82–100 %) |
| Upprepade segment | – | 6–28 % |
| Alternativ väg till målet | 2–96 % (lägst i Skutberget: 36 % vid 5 km, 2 % vid 8 km; I2-skogen 88–96 %) | – |
| Generering (medel / p95, Node) | 18–150 / 52–360 ms | 130–1 300 / 240–2 200 ms |

Begränsningar: testytorna är 3 × 3 km, så MTB 15 km och löpning > 8 km är data-/ytbegränsade, inte algoritmbegränsade. Skutberget har sämst resultat på grund av Vänerns strand (få riktningar).

### Spelbalans (1 620 matcher: 3 områden × 3 aktiviteter × 3 svårigheter × 3 lägen × 2 bottar × 10 seeds)

Vinstfrekvens, planerarbot (95 % KI i filen). Absoluta nivåer beror på bottarna.

| | Lätt | Normal | Svår | Totalt |
|---|--:|--:|--:|--:|
| **Escape** (promenad 1,5 km, löpning 3 km, MTB 5 km) | 86 % | 60 % | 46 % | 64 % |
| **Mission** (promenad 2,5 km, löpning 5 km, MTB 8 km) | 69 % | 47 % | 20 % | 45 % |
| **Survival** (promenad 30 min, löpning och MTB 45 min) | 64 % | 48 % | 19 % | 44 % |

- Svårighetsgraderna skiljer sig tydligt i alla tre lägen, och aktivitet likaså (promenad 69–80 %, MTB 21–49 %). Skutberget är svårast i alla lägen (Mission 31 %, I2-skogen 60 %).
- **Planeraren slår ruttföljaren** (Escape 64 mot 49 %, Mission 45 mot 31 %): att kunna vika av spelar roll, vilket stöder kravet att spelaren får lämna referensrutten. Boten avviker från rutten i 6–21 % av vägvalen och möter "blockerade vägval" (en zombie hinner före på den mest målinriktade vägen) i 4–18 % (Lätt 4–6 %, Svår 16–18 %).
- Median tid till mål: Escape 19 min, Mission 31 min, vinnarna använder 43–53 % av tidsgränsen. Tidsgränsen är alltså generös och blir sällan avgörande (0–7 % av matcherna slutar med tidsgräns ute utan infektion).
- **Checkpoints:** 1, 2 eller 3 st vid fast 5 km ger 37/36/39 % (planerare) och 22/19/26 % (följare). Ingen skillnad. Checkpoints är en uppdragsstruktur, inte ett balansmått.
- **Återvändsgrenspolicy (ablation, giltig):** med policyn avstängd får 15 % av rutterna en målpunkt > 60 m in i en återvändsgren och 23 % en enda utgång. Vinstfrekvens 42 % mot 43 % (planerare), 26 % mot 28 % (följare); parvis 18 mot 20 respektive 15 mot 18; infektion 61 % med djup checkpoint mot 65 % utan. **Ingen mätbar effekt**. Regeln behålls som uppdragsdesign och säkerhet ("blockera enda vägen"), inte som balansåtgärd. (Först var ablationen felaktig: rankningen undvek ändå djupa punkter. Rättad.)
- **Jämförelse mellan lägen:** Escape är lättast, Mission och Survival ungefär lika svåra. Mission kräver ~60 % längre tid i fält än Escape, vilket förklarar en del.

Kända simuleringsartefakter: distansmåttet (`distanceM`) ignorerar steg < 0,5 m och blir 0 för promenad (motorn, inte reglerna); starten är alltid på nätet; GPS är perfekt; bottarna ser zombiernas positioner men inte framtiden.

## 6. Kvarstående problem inför riktig GPS och mobil

1. **Start utanför nätet:** generatorn kräver start ≤ 150 m från stig; appen behöver gå-till-stig-steg och måste tåla att spelaren startar i en återvändsgren.
2. **GPS-brus mot 30 m-radien:** OSM-geometri ±10 m plus GPS-fel. Bekräftelsen nollställs om brus kastar spelaren utanför radien; överväg hysteres (30 m in, 40 m ut) och fälttesta.
3. **Tidsgränsens kalibrering:** "lugn fart" är antagen (60 % av nominell). Måste kalibreras mot verklig fart och terräng, särskilt MTB uppför.
4. **Tillträde:** uttryckliga tillträdesattribut finns på 0–18 % av ways. Konservativ filtrering ("tillåtet om inte förbjudet") är nödvändig men innebär att ruttförslag kan använda stigar med oklart tillträde. Kräver spelarinformation och rapporteringsväg.
5. **Hemkomstzonen:** zombier kan samlas nära starten under Mission eftersom spawn-undantaget bara gäller checkpoints och destination, inte "hem". Mät i fält.
6. **Beräkningskostnad på mobil:** Mission-generering tar 0,1–1,3 s medel (p95 2,2 s) i Node; på en mobil troligen 3–5 × mer. Generera på servern (cachas per start/längd) eller sänk `samples`.
7. **Enkelriktade MTB-stigar** (`oneway:bicycle`) saknar regelhantering för människor (spelaren kan hamna i noder utan utgång). Bara testverktyget hanterar det (spelaren vänder).
8. **Data:** ofullständigt tillträde i OSM, inga staket/hinder-data (se hybridstudien), Lantmäteri-jämförelsen ej gjord.
9. **Bakgrund/avbrott (iOS-PWA):** matchtillstånd inklusive `objectives` måste snapshotas i IndexedDB; återupptagning kräver ny positionskontroll (finns i PRD, inte implementerat).
10. **Fälttest saknas helt:** rutternas upplevda kvalitet, tidspress och säkerhet (särskilt MTB-slingor och korsningar med större vägar) kan bara avgöras i fält.

## 7. Minsta implementation för etapp 3

1. **Datalager:** behåll `/api/terrain` men byt Overpass mot förberäknade stiggrafer från ett länsextrakt (offline-jobb, t.ex. schemalagd körning med `extract_pbf.py`-logiken, per ~5 × 5 km-cell, lagrad som statiska filer eller i Vercel-cache). Klienten cachar i IndexedDB (`terrainCache`). Ingen ny databas.
2. **Motorn:** flytta in `src/engine/objectives`, `src/config/modes.ts` och `src/routes` (redan i `src/`, redan testade) i produktionsflödet; ingen ändring av zombie-AI.
3. **GPS → motor:** koppla `watchPosition` → `GpsFilter` → `StepInput` (`position`, `quality`), vilket gör att målbekräftelsen fungerar utan ändring.
4. **Spelkonfiguration:** NEW GAME med val av läge, aktivitet, distans/matchtid och svårighet; för Escape/Mission en förslagsskärm (återanvänd kartkoden i `/dev/routes`: 2–3 rutter, destination/checkpoints, kvalitetsflaggor, tidsgräns) och val av rutt.
5. **Pågående match:** snapshot av `GameState` inklusive `objectives` i IndexedDB; återupptagning med ny positionskontroll.
6. **Före lansering:** fälttest av tidsgräns, 30 m-radie och ruttkvalitet (minst en Mission och en Escape per aktivitet), samt beställning av Lantmäteridata för den uppmätta jämförelsen (parallellt, blockerar inte etapp 3).

**Rekommendation:** gör etapp 3 med **OSM som enda källa** och bygg **Mission och Escape ovanpå samma motor som Survival**. Börja med Mission, eftersom ruttgeneratorn är starkast där och lägets spelbalans är lik Survival. Skjut upp Lantmäteri-integrationen till efter fälttest och juridisk granskning.

## 8. Begränsningar och vad som inte är gjort

- Ingen uppmätt jämförelse OSM mot Lantmäteriet (data kräver inloggning).
- Alla spelresultat kommer från bottar på perfekt GPS i tre områden i samma stad; absoluta vinstnivåer är inte vinstsannolikheter. Relativa skillnader (svårighet, planerare mot följare, checkpoints, återvändsgrenspolicy) är det som går att läsa.
- Generatorn och bottarna är experimentkod: ingen UI-polering, inga produktionsfel- eller kantfall (t.ex. GPS-förlust under Mission).
- Inga fysiska enhetstester, inga fälttester.
- Git remote saknas och autentisering fungerar inte, så branchen är **inte pushad**.
