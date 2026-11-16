# Kartdata globalt: utredning

Datum: 2026-11-16. Fråga: hur kan spelet fungera utanför Värmland?

## Kort svar

**Rekommendation: bygg spelets stignät ur OpenFreeMaps vektortiles.** Det är samma globala tiles som appen redan hämtar för
bakgrundskartan och för byggnader och vatten. Det är mätt mot vårt OSM-underlag i Värmland: nätet blir nästan lika bra, kostar ingen
extra nedladdning och ingen egen infrastruktur, och fungerar var som helst. Två brister måste hanteras innan det släpps
(avsnitt 4): taggarna `sac_scale` och `trail_visibility` saknas, och cirka 10 % av korsningarna återskapas inte.

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

Experimentet ligger i `experiments/global/`:

- `ofm-ways.ts` är en adapter från vektortiles till klientens `TileWay`. Vägtyp, tillträde, fot, cykel, mtb-skala, underlag,
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
| Karlstad (tätort) | 167,5 / 159,6 | 95,4 % | 99,6 % | 88,5 % | 99,3 % |
| I2-skogen | 61,2 / 65,2 | 98,6 % | 93,8 % | 93,8 % | 82,3 % |
| Skutberget | 26,1 / 26,9 | 99,6 % | 96,6 % | 95,5 % | 94,7 % |
| Sörmon | 53,2 / 54,7 | 98,8 % | 96,1 % | 96,3 % | 99,0 % |
| Karlstad, radie 6 km | 1 128,7 / 1 114,5 | 96,4 % | 97,8 % | 89,5 % | 96,3 % |

- **Utan reparationerna** täckte OFM bara 82,5 % av Karlstads facit och hittade 46,5 % av korsningarna, eftersom nätet föll sönder
  i bitar. Ändfogningen ger 96,7 % och 78 %, båda reparationerna tillsammans 95,4 % och 88,5 %. Toleransen planar ut vid 1 m (3, 6 och
  10 enheter ger samma resultat).
- **Geometrin finns i praktiken till 100 %.** Per vägtyp saknas högst 0,2 % av längden i tilesen. Resterande förlust är topologi. De
  flesta återstående missade korsningarna ligger där OFM bara har den genomgående linjen, alltså där en kort sidostump saknas.
  Tilegränserna är inte orsaken: 7 av 249 missar, vilket motsvarar slumpen.
- **Extra längd i skogen** (I2-skogen +4 km): 3,4 km är stigar som vårt filter utesluter för att de är dåligt synliga
  (`trail_visibility=bad/horrible/no`). Den taggen finns inte i OpenMapTiles. Det förklarar också de lägre värdena för "äkta"
  korsningar där.
- **Farliga passager** (stig som delar nod med större väg, järnväg eller vattendrag): 238 av 247 hittas i Karlstad (96 %) och 6 av 6
  i skogen. 97 % av OFM:s passager är äkta.
- **Spelutfall** (`sim-ofm.ts`, Survival Normal, riskboten, 12 frön): samma fångstfrekvens på båda näten (11–12 av 12). Mediantiden
  till fångst skiljer sig inom bruset, till exempel 9,9 mot 8,4 min till fots i Karlstad och 32 mot 25 min på cykel.
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

## 4. Vad som måste lösas innan B släpps

1. **Säkerhetstaggar som saknas.** `sac_scale` (alpina leder) och `trail_visibility` finns inte i OpenMapTiles. I Värmland gör det
   lite, men i fjäll- och alpområden kan spelet lägga en checkpoint på en alpin led. Möjliga åtgärder:
   - lägga checkpoints och rutter (det strikta nätet) bara på vägtyper som sällan är alpina: footway, cycleway, track, service och
     minor, samt path med `foot=designated` eller belagd yta, medan zombierna får använda allt
   - markera matcher utanför de exakta regionerna som beta, med en tydligare varning
   - gå vidare till alternativ D.
2. **Missade korsningar** (5–12 %). De gör nätet något glesare men aldrig farligare, eftersom felet är att två stigar inte förbinds.
   Falska korsningar är få (1 % i tätort), men de förekommer. Korsningsreparationen kan förbinda två stigar i samma nivå som i OSM
   faktiskt inte möts, så den bör granskas i fält.
3. **Underlag och spårtyp.** `surface` är bara belagd eller obelagd, och `tracktype` saknas. Det påverkar bara cykelns val av
   "lättcyklade" vägar för checkpoints.
4. **Beroende och aktualitet.** OpenFreeMap är gratis utan nyckel men har inget avtal eller någon garanti. Datan uppdateras ungefär
   varje eller varannan vecka; i dag gällde ett bygge från 2026-11-01. Tilesens version (sökvägen i TileJSON) bör användas som
   `dataVersion`.
5. **Prestanda på telefon** för cykel: optimera fogningen (i dag cirka 1 s i Node för 121 tiles), eller kör den i en Web Worker.

## 5. Föreslagen väg

1. **Steg 1, en till två veckors arbete.** Flytta adaptern till `src/data/` som en datakälla med samma gränssnitt som `TileStore`
   (`loadManifest`, `covers`, `loadAround`, `dataVersion`). `prepare.ts` väljer OSM-tiles där de finns (Värmland) och OpenFreeMap
   annars. Lägg till punkt 1 i avsnitt 4 (säker vägtyp för checkpoints), tester mot de sparade fixturerna och en markering i
   fältloggen av vilken källa matchen använde. Fälttesta på en ort utanför Värmland.
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

**Värmlandstilesen saknar hindertyp.** Fältet `k` saknas i tilesen (0 av 5 165 hindervägar i ett stickprov om 200 tiles), så
klienten använder reservregeln för äldre tiles i stället för v2.2-regeln, där passager över secondary och tertiary kopplas.
`build_tiles.py` stödjer `k`, men datan verkar inte ha byggts om sedan dess. Det bör kontrolleras separat. OpenFreeMap-adaptern
sätter typen.
