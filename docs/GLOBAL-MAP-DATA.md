# Kartdata globalt: utredning och steg 1

Datum: 2026-11-16. Fråga: hur kan spelet fungera utanför Värmland?

**Status: steg 1 är implementerat** (avsnitt 5). Vuxenappen använder våra OSM-tiles i Värmland och OpenFreeMap överallt annars.
Mini Outbreak är oförändrad och fortfarande begränsad till Värmland.

## Kort svar

**Rekommendation: bygg spelets stignät ur OpenFreeMaps vektortiles.** Det är samma globala tiles som appen redan hämtar för
bakgrundskartan och för byggnader och vatten. Det är mätt mot vårt OSM-underlag i Värmland: nätet blir nästan lika bra, kostar ingen
extra nedladdning och ingen egen infrastruktur, och fungerar var som helst. Två brister finns (avsnitt 4): taggarna `sac_scale` och
`trail_visibility` saknas, vilket hanteras med en försiktighetsregel för alpin terräng, och 2–9 % av korsningarna återskapas inte.

**På sikt: egna tiles med Planetiler** (avsnitt 5, alternativ D), om bristerna visar sig spela roll i fält eller om vi vill vara
oberoende av OpenFreeMap.

## 1. Nuläget

- **Stignätet** kommer från ett förbyggt OSM-underlag för Värmland i repot (`public/data/v1/varmland`): 786 rutor om
  0,05° × 0,1°, 82 000 vägar, 10,3 MB gzip. Det byggs av `experiments/data/build_tiles.py` ur ett länsextrakt
  (download.openstreetmap.fr) med pyosmium.
- **Spelet använder ur datan:**
  - OSM:s nod-id, för topologin: korsning = delad nod. Två vägar som bara korsar varandra, som en bro, förbinds aldrig.
  - Taggarna highway, access, foot, bicycle, mtb:scale, oneway, sac_scale, trail_visibility, ford, bridge/tunnel, surface och
    tracktype (filtren i `src/geo/osm/overpass.ts`).
  - "Farliga passager", det vill säga noder som en stig delar med en större väg, järnväg eller vattendrag.
- **Begränsningen till Värmland sitter på tre ställen:**
  - täckningskontrollen i `src/play/prepare.ts` (`store.covers`, med statusen `outside_region`)
  - datakällan `TileStore` med `DATA_BASE = "/data/v1/varmland"`
  - två felmeddelanden.

  Grafbygget (`buildRegionGraph`), motorn, AI:n och ruttgeneratorn är källoberoende.
- **Undantag:** A TO B till fots fungerar redan överallt. Spelet bygger ett terrängnät och använder stigar bara där data finns.
- **Redan globalt:**
  - Bakgrundskartan och hindren (byggnader och vatten) kommer från OpenFreeMap på z14. Det är just de tiles som nedan blir
    stigkälla.
  - Attributionen för OSM och OpenMapTiles finns redan i appen.

## 2. Alternativ

| | Källa | Täckning | Nedladdning | Infrastruktur | Datakvalitet för spelet | Bedömning |
|---|---|---|---|---|---|---|
| **A** | Förbyggda OSM-tiles som i dag, för fler regioner | Det vi bygger | ~0,4 KB/km² gzip | Byggjobb på planet-/landsextrakt plus objektlagring och CDN. Sverige ≈ 150–300 MB, Europa några GB, världen tiotals GB (uppskattning från Värmlands täthet) | Exakt (alla taggar, riktig topologi) | Bra för enskilda länder. Global täckning kräver en driftad pipeline. |
| **B** | **OpenFreeMap-vektortiles (OpenMapTiles-schema)** | **Hela världen** | **0 extra** (laddas redan för hindren) | **Ingen** | Nästan exakt, se avsnitt 3 | **Rekommenderas som första steg** |
| C | Overpass API live | Hela världen | Liten | Ingen | Exakt | Avråds. Publika instanser är otillförlitliga (9 av 9 oanvändbara i den tidigare studien, och ingen nåbar härifrån i dag) och användarvillkoren tillåter inte appbelastning. Koden i `overpass.ts` används bara för filtren. |
| D | Egen Planetiler-profil → PMTiles på CDN | Hela världen | Som B eller mindre | Ett byggjobb (planet på några timmar på en större server) plus en statisk fil på objektlagring | Exakt: vi väljer taggar och kan märka korsningar och hinder | Bästa långsiktiga lösningen |

## 3. Mätning: OpenFreeMap-tiles mot vårt OSM-underlag

Koden ligger i `src/data/ofm-store.ts` (används av appen) och mätskripten i `experiments/global/`:

- `waysFromTiles` gör om vektortiles till klientens `TileWay`. Vägtyp, tillträde, fot, cykel, mtb-skala, underlag,
  bro/tunnel/vadställe och enkelriktat översätts till OSM-taggar.
- Nod-id ersätts av den exakta globala pixelpositionen på z14, cirka 0,3 m. Linjer som delade en OSM-nod har en hörnpunkt på
  samma heltalsposition. Linjer som bara korsar varandra har det inte.
- Två reparationer behövs, eftersom tilesens linjeförenkling tar bort korsningspunkter:
  - En linjeände inom cirka 1 m från en annan linje fogas till den. Aldrig till en bro eller tunnel, och aldrig mellan olika nivåer.
  - Två linjer på samma nivå som korsar varandra utan hörnpunkt, och där ingen av dem är bro eller tunnel, får en gemensam punkt.
- Sedan körs **samma oförändrade `buildRegionGraph`** på båda underlagen.

Kör så här:

```bash
npx tsx experiments/global/compare-ofm.ts 1500 karlstad,i2-skogen,skutberget,sormon
```

```bash
npx tsx experiments/global/sim-ofm.ts 12
```

### Nätet (gång, radie 1,5 km; cykel ger samma bild)

| Område | km OSM / OFM | Facitlängd som OFM täcker (10 m) | OFM-längd som finns i facit | Facitkorsningar som hittas (5 m) | OFM-korsningar som är äkta |
|---|--:|--:|--:|--:|--:|
| Karlstad (tätort) | 167,5 / 160,7 | 95,8 % | 99,6 % | 90,9 % | 99,3 % |
| I2-skogen | 61,2 / 65,2 | 98,6 % | 93,8 % | 94,1 % | 82,3 % |
| Skutberget | 26,1 / 27,1 | 99,7 % | 96,6 % | 98,2 % | 94,9 % |
| Sörmon | 53,2 / 54,7 | 98,8 % | 96,1 % | 98,1 % | 99,1 % |
| Karlstad, radie 6 km | 1 128,7 / 1 132,8 | 97,9 % | 97,8 % | 92,0 % | 96,4 % |

- **Utan reparationerna** täckte OFM bara 82,5 % av Karlstads facit och hittade 46,5 % av korsningarna, eftersom nätet föll sönder
  i bitar. Ändfogningen ger 96,7 % och 78 %, båda reparationerna tillsammans 95,8 % och 90,9 %. Toleransen planar ut vid 1 m (3, 6 och
  10 enheter ger samma resultat). Siffrorna i tabellen är från appens kod. Experimentets första version sökte korsningar bara nära
  segmentens ändar och missade några; det rättades innan koden flyttades in.
- **Geometrin finns i praktiken till 100 %.** Per vägtyp saknas högst 0,2 % av längden i tilesen. Resterande förlust är topologi. De
  flesta återstående missade korsningarna ligger där OFM bara har den genomgående linjen, alltså där en kort sidostump saknas.
  Tilegränserna är inte orsaken: 7 av 249 missar, vilket motsvarar slumpen.
- **Extra längd i skogen** (I2-skogen +4 km): 3,4 km är stigar som vårt filter utesluter för att de är dåligt synliga
  (`trail_visibility=bad/horrible/no`). Den taggen finns inte i OpenMapTiles. Det förklarar också de lägre värdena för "äkta"
  korsningar där.
- **Farliga passager** (stig som delar nod med större väg, järnväg eller vattendrag): 238 av 247 hittas i Karlstad (96 %) och 6 av 6
  i skogen. 97 % av OFM:s passager är äkta.
- **Spelutfall** (`sim-ofm.ts`, Survival Normal, riskboten, 12 frön, appens kod): samma fångstfrekvens på båda näten (11–12 av 12).
  Mediantiden till fångst till fots är nära (Karlstad 9,9 mot 10,9 min, I2-skogen 4,6 mot 4,1). På cykel skiljer den mer: Karlstad
  32 mot 20 min, I2-skogen 24 mot 27 min. Med 12 matcher kan det vara brus, men cykel i tätort bör följas upp.
- **Tid och data:**

  | | Tiles | Nedladdning | Avkodning och fogning | Grafbygge |
  |---|--:|--:|--:|--:|
  | Gång, radie 1,5 km | 12–16 | 0,1–0,7 MB | – | 10–240 ms totalt |
  | Cykel, Karlstad, radie 6 km | 121 | 2,3 MB | 0,9 s | 0,2 s |

  Tiderna är uppmätta i Node på en server. En telefon är uppskattningsvis 3–5 gånger långsammare, alltså några sekunder i
  förberedelsen för cykel. Nedladdningen sker redan i dag för hindren.

### Utanför Sverige (bara nätets storlek, inget facit)

| Område | Gång km (största komponent) | Cykel km | Nedladdning | Tid |
|---|--:|--:|--:|--:|
| Schwarzwald vid Freiburg | 111 | 88 | 1,3 MB | 0,1 s |
| London, Hampstead Heath | 123 | 7 | 2,2 MB | 0,1 s |
| Boulder, Colorado | 126 | 49 | 1,0 MB | 0,1 s |
| Tokyo, Yoyogi | 165 | 5 | 5,0 MB | 0,2 s |
| Nairobi, Karura | 42 | 14 | 0,4 MB | 0,02 s |

Gångnäten blir sammanhängande och rimliga överallt. Cykelnätet blir mycket litet i storstäder. Det beror inte på källan utan på
spelets regel att cykel inte får använda större vägar, som också behandlas som hinder. Regeln behöver ses över för städer oavsett
datakälla.

## 4. Kända brister och hur de hanteras

1. **Säkerhetstaggar som saknas.** `sac_scale` (alpina leder) och `trail_visibility` finns inte i OpenMapTiles. I Värmland gör det
   lite, men i fjäll- och alpområden kan spelet annars lägga en checkpoint på en alpin led.
   **Implementerat:** en vanlig stig (`path` eller `bridleway`) som går genom berg, sten eller is enligt tilesens landcover-lager
   (klass `rock` eller `ice`), och som saknar positiva signaler (`foot=yes/designated/permissive`, `bicycle=designated`, belagd yta
   eller `mtb:scale` högst 2), får taggen `outbreak:route=no`. Det strikta nätet för rutter och checkpoints utesluter den, men
   spelnätet behåller den så att zombierna kan använda den.
   Begränsning: en alpin led genom gräs eller skog under trädgränsen fångas inte. Dåligt synliga stigar tas med, vilket
   motsvarar +4 km i I2-skogen.
2. **Missade korsningar** (2–9 %). De gör nätet något glesare men aldrig farligare, eftersom felet är att två stigar inte förbinds.
   Falska korsningar är få (1 % i tätort), men de förekommer. Korsningsreparationen kan förbinda två stigar i samma nivå som i OSM
   faktiskt inte möts, så den bör granskas i fält.
3. **Underlag och spårtyp.** `surface` är bara belagd eller obelagd, och `tracktype` saknas. Det påverkar bara cykelns val av
   "lättcyklade" vägar för checkpoints.
4. **Beroende och aktualitet.** OpenFreeMap är gratis utan nyckel men har inget avtal eller någon garanti. Datan uppdateras ungefär
   varje eller varannan vecka; i dag gällde ett bygge från 2026-11-01. **Implementerat:** bygget i tile-URL:en blir matchens
   `dataVersion` (`ofm-20261101_080013_pt`), syns i fältloggen och i `areaId` (`openfreemap@…`).
5. **Prestanda på telefon** för cykel: cirka 0,9 s för 121 tiles i Node, alltså uppskattningsvis några sekunder på en telefon.
   Ej optimerat; en Web Worker är nästa steg om det märks.
6. **Ingen nätverksanslutning.** OSM-tilesen sparas i IndexedDB, men OpenFreeMap-tilesen bara i webbläsarens HTTP-cache och i minnet
   under sessionen. Utan nät kan en match utanför Värmland inte förberedas. A TO B i terräng faller tillbaka på ett rent terrängnät.

## 5. Föreslagen väg

1. **Steg 1, implementerat.**
   - `OfmStore` (`src/data/ofm-store.ts`) och `FallbackStore` (`src/data/store.ts`) har samma gränssnitt (`WayStore`) som
     `TileStore`. `FallbackStore` tar OSM-tilesen när hela cirkeln ligger inom deras område och OpenFreeMap annars, så att en match
     aldrig blandar källor.
   - `prepare.ts` och kampanjens förberedelse tar emot `WayStore`. Vuxenappen kopplar in `FallbackStore` i `SessionProvider.tsx`.
   - Taggen `outbreak:route=no` utesluts ur det strikta nätet i `region-graph.ts`.
   - Tester: `src/tests/unit/ofm-store.test.ts`, med handgjorda tiles för varje regel, två riktiga tiles över Värmland jämförda med
     OSM och en hel förberedelse i Nairobi från sparade tiles.
   - **Kvar: fälttest på en ort utanför Värmland.**
2. **Steg 2, efter fälttest.** Använd OpenFreeMap även i Värmland om resultaten håller. Då kan repots 32 MB data och byggskriptet
   tas bort.
3. **Steg 3, vid behov.** Gå till egen Planetiler-profil (alternativ D) med de taggar spelet behöver, markerade korsningar och hinder,
   och en PMTiles-fil på CDN. Det tar bort alla brister i avsnitt 4 utom aktualiteten, som då styrs av vår byggfrekvens.

Det starkaste argumentet mot steg 1 är att spelet blir beroende av en gratistjänst utan avtal, både för stignätet och för
kartan. Kartan är redan beroende av den i dag, så risken ökar mindre än det verkar, och alternativ D är reservplanen.

## 6. Juridik (ingen juridisk rådgivning)

- OSM-data är ODbL. Grafen är härledd ur OSM och byggs på klienten, så det är ett "produced work" med attributionskrav, vilket
  redan uppfylls i appen.
- OpenMapTiles-schemat kräver attribution "© OpenMapTiles", som också redan finns.
- Med alternativ A eller D, där vi distribuerar en härledd databas, gäller ODbL:s share-alike för den databasen.

## 7. Sidofynd

**Värmlandstilesen saknade hindertyp** (åtgärdat 2026-11-17). Fältet `k` saknades, så klienten använde reservregeln för äldre
tiles i stället för v2.2-regeln, där bara passager över secondary och tertiary kopplas. `k` är nu tillagt i de befintliga tilesen
med `experiments/data/add_hazard_kinds.py`, utan att något annat i dem ändrats. Mätning före och efter och konkreta passager:
[`STATUS-2026-11-17.md`](STATUS-2026-11-17.md) §3. OpenFreeMap-adaptern satte redan typen, så nu gäller samma regel i och utanför Värmland.
