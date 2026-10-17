# Hybrid-AI-studie: verkliga stignät och off-road-zombier

Gren: `experiment/hybrid-offroad` · Datum: 2026-10-17 · Status: undersökning, ingen produktionsändring utöver neutrala hakar (se F).

## Sammanfattning och rekommendation

**Rekommendation: alternativ 3, hybrid-AI först i en senare version. Behåll stigbunden AI i v1.** Om utlösarna i G inte uppfylls efter fälttest är alternativ 1 det rätta (aldrig bygga).

Skälen, i fallande vikt:

1. **Ingen mätbar spelmekanisk nytta.** Över 17 064 simulerade matcher (13 356 parvisa jämförelser mot modell A) på tre verkliga områden går hybrid inte att skilja från stigbunden AI. Poolat vid 25 % hastighet: vinstfrekvensen ändras +0,9 procentenheter [−0,6; +2,3] (n = 2 988 par), vid 50 %: +0,4 [−1,3; +2,1] (n = 2 088). Detta är en mätning med smalt konfidensintervall, inte en frånvaro av data.
2. **Mekanismen är förstådd.** 364 av 384 off-road-ben (95 %) börjar i läget INVESTIGATE, 19 i CHASE (B2-25: 41 av 44, B2-50: 131 av 135, stresstest: 192 av 205). Zombier tar genvägar mot en gammal observerad position (positionsavslöjandet ligger 60–180 s bakåt), och då är tidsvinsten på några procent betydelselös: spelaren har redan flyttat sig. Off-road utgör 0,15–1,5 % av zombiernas färdsträcka i de modeller som är säkra att införa.
3. **Det går att göra säkert, men kräver ett nytt datalager.** 0 av 4 509 genererade förbindelser korsar ett känt hinder enligt exakt vektorgeometri. Men OSM innehåller nästan inga mappade staket, och väg dit krävde att jag hittade och rättade fem separata fel (se 7). Produktionsversionen behöver terrängdata i API:t, server-side generering, validering och en licensbedömning.
4. **Hakarna är billiga och kan stanna.** Hela mekanismen kräver 9 filer (+109/−53 rader, varav en är testverktyget), är bevisat no-op för stigbundna grafer (12 matcher bit-identiska mot `master`, 85 tester gröna), och är det naturliga förlängningsstället som PRD 4.3 redan pekade ut ("kostnaden ska kunna kompletteras med underlag, lutning…"). Att skjuta upp kostar därför nästan ingenting.

**Starkaste motargumentet mot min rekommendation.** Simuleringen kan inte mäta det som hybrid-AI egentligen är till för: upplevd naturlighet ("zombier går på räls") och överraskning. Mina bottar tittar inte på skärmen, tvekar inte och reagerar inte känslomässigt på en zombie som plötsligt kommer genom skogen. Dessutom är nollresultatet delvis *konstruerat*: med 25 % hastighet, verifierad terräng och nyttokrav används off-road knappt (0,3 % av färdsträckan), så att ingen effekt syns är nästan given. Jag har testat större effekter (50 % hastighet, 400 m, okänd mark tillåten, upp till 5 % off-road), och även där syns bara små effekter (≤ 2,5 procentenheter, upp till +7 s "instängd" per match), men det visar inte att *upplevelsen* är oförändrad. Det enda som kan avgöra det är ett fälttest, och därför är rekommendationen "senare", inte "aldrig". Jag har inte hittat något som talar *emot* att skjuta upp; det motargument som återstår är att realism-vinsten kan vara större än simuleringen kan se.

## 0. Vad som är mätt och vad som är antaget

| Typ | Innehåll |
|---|---|
| **Mätt, verkliga data** | OSM-innehåll i tre områden (antal, taggar, marktäcke), grafstorlek, byggtid, A\*-tid, genvägsnytta, hinderkorsningar (exakt vektorkontroll), 17 064 simulerade matcher, off-road-benens längd/tillstånd |
| **Mätt, grovt** | Brantfördelning (30 × 30 punkter à ~100 m), minne (heap-delta i Node) |
| **Antaget** | Att "skog"-polygoner i OSM är framkomliga (OSM säger inget om undervegetation, täthet eller klippor), att 15–50 % av stighastigheten är en rimlig off-road-fart, att spelarbottarna liknar spelare, att zombiehastigheter och spawn-regler (från PRD) är rimliga |
| **Kan bara avgöras i fält** | Upplevd naturlighet, läsbarhet av terrängzombier på en liten mobilkarta, om spelare lockas lämna stigar, om okända hinder (staket, tät skog) gör zombiernas rörelser orimliga |

Alla statistiska jämförelser är **parvisa**: modell A och B får identisk startposition, identiska startzombier, samma spelarstrategi och samma seed. Slumpströmmen divergerar därefter när zombierna beter sig olika, så parningen minskar variansen mindre än man hoppas (det är hela skälet till de stora urvalen). Konfidensintervall är 95 %. Enstaka p-värden i stratifierade tabeller ska läsas mot att 150 sådana tester gjordes (se C).

## 1. Inventering av befintlig implementation

(Fullständiga filreferenser: `src/`.)

| Del | Vad finns | Relevans för hybrid |
|---|---|---|
| **Grafmodell** | `TrailGraph` (noder, kanter med `lengthM`, `oneway`, grannlistor, komponenter via union-find). `buildGraph` delar ways bara i noder med delat id, så broar blir aldrig falska korsningar | Kanter är redan förstklassiga objekt med attribut |
| **OSM-import** | `decideWay` filtrerar konservativt per aktivitet (MTB: `bicycle=no`, `mtb:scale ≥ 4`, gångväg kräver `bicycle=yes`). Bygger på `highway`-ways | Terräng (landuse/natural) lästes inte alls tidigare |
| **A\*** | Multikälle-A\* med kostnad C(e)=L/v(e), haversine-heuristik, `SpeedFn` per kant redan i `planRoute` | Per-kant-hastighet fanns som hook men användes aldrig |
| **Rörelse** | `advanceZombie` byter kant bara i delad nod, `z.speedMps × STEP_S` konstant | Behövde 1 rad för kanthastighet |
| **AI** | FSM patrol/investigate/chase/intercept, replan 5–10 s (2 s under kontakt), tactical 20–30 s, intercept via korsningar framför senast observerad riktning | Förbinder via `planRoute`, ingen ändring av beteendelogik |
| **Spawn** | Längdviktat slumpat på spelarens komponent, ≥ min-avstånd geografiskt och längs nätet, 100 m mellan zombier | Måste välja stigkanter, inte förbindelser |
| **Reveal** | Var 60/120/180 s; patrol→investigate med sannolikhet 0,8/0,6/0,4 | Förklarar varför genvägar används vid INVESTIGATE |
| **Infektion/extraction** | 20 m/3 s (5 s vid noggrannhet 10–20 m); extraction på spelarens komponent, degree ≥ 2 | Extraction måste ses ur *spelarens* graf |
| **Simulering** | `SimSession`, 4 strategier, syntetiska nät | Utökades med spelargraf, planerarbottar, hooks |

**Hur hybrid införs utan omskrivning.** Tre små idéer räcker: (1) kantattribut `offroad` och `speedFactor`, (2) en *spelarvy* `trailOf(g)` av grafen utan förbindelser som alla spelarvända funktioner (snappning, korsningsgrad, extraction) använder automatiskt, (3) en kedjeregel i A\* som förbjuder två förbindelser i följd. Se F för exakt diff.

### Kända avvikelser från PRD (ej ändrade)

1. Infektion kräver **5 s** i stället för 3 s vid GPS-noggrannhet 10–20 m (PRD 6.3: "ytterligare verifiering", ospecificerat).
2. Matchtiden **inkluderar** försprånget och zombier står stilla under det (PRD tiger).
3. PRD 3.4 "inte placeras där infektion blir oundviklig" är **approximerat** med nätavstånd ≥ minimiavstånd, inte en analys av återvändsgränder.
4. Replan under direktkontakt var **2 s** (PRD 8.4: 5–10 s "eller vid relevant händelse", vilket är tolkningsbart).
5. **Saknad `access`-tagg tolkas som tillåten** för stigar/spår, medan PRD 5.4 säger "vid oklar åtkomst: konservativ tolkning". Sannolikt en verklig avvikelse.
6. Zombier hålls i spelarens komponent (PRD tiger).
7. Fynd från verkliga data: MTB-filtret tillämpar `oneway:bicycle`, vilket skapade noder utan utgång där den simulerade spelaren fastnade (rättat i testverktyget, inte i spelreglerna). Spelreglerna har ingen definierad hantering av enkelriktade stigar när en *människa* tar sig dit.
8. Tailwind, IndexedDB och riktig GPS i UI är inte implementerade (etapp 3–4), vilket är väntat.

## 2. Geografiska data (leverans A)

**Kunde hämtas:** alla tre områden, verkliga OSM-data. **Overpass kunde inte användas** och jag har inte hittat på något i dess ställe:

| Källa | Utfall |
|---|---|
| `overpass-api.de` | Anslutningen stängdes av egress-proxyn (tunneln stängdes mitt i anropet) |
| `lz4.overpass-api.de`, `z.overpass-api.de` | Ingen anslutning |
| `overpass.private.coffee`, `overpass.kumi.systems` | HTTP 500 vid alla frågor (instanserna trasiga vid hämtningen) |
| `overpass.openstreetmap.fr`, `overpass.osm.jp` | 403 "white-listed usages only" |
| `overpass.osm.ch` | Svarade, men täcker bara Schweiz (tomt för Sverige, **användes inte**) |
| `overpass.nchc.org.tw` | 502 |
| **`api.openstreetmap.org` `/api/0.6/map`** | **Fungerade**: hämtat i 2 × 2 tiles per område, plus `/relation/<id>/full` för 19 ofullständiga relationer |

| Område | Bbox (S, W, N, Ö) | Noder / ways / relationer (rått) |
|---|---|---|
| Skutberget | 59.3588, 13.368, 59.3858, 13.42 | 6 089 / 624 / 39 |
| I2-skogen | 59.3965, 13.44, 59.4235, 13.492 | 19 265 / 2 461 / 77 |
| Sörmon | 59.365, 13.328, 59.392, 13.38 | 5 002 / 372 / 30 |

Källa, licens (ODbL 1.0), tidpunkt och begränsningar: `fixtures/README.md` och `fixtures/*.meta.json`. Avgränsningarna är mina egna (centrerade på Nominatim-träffar); "I2-skogen" har flera träffar och rutan täcker två av dem.

**Stignät (efter OSM-filtrering, klippt till rutan, största komponent):**

| Område | Aktivitet | Noder / kanter | Längd | Korsningar | Återvändsgrenar | Enkelriktade kanter |
|---|---|--:|--:|--:|--:|--:|
| Skutberget | löpning | 251 / 317 | 35,4 km | 161 | 20,9 % av längden | 0 |
| Skutberget | MTB | 222 / 273 | 32,7 km | 135 | 25,3 % | 15 |
| I2-skogen | löpning | 725 / 948 | 87,5 km | 511 | 16,3 % | 0 |
| I2-skogen | MTB | 672 / 877 | 84,7 km | 473 | 18,2 % | 9 |
| Sörmon | löpning | 325 / 483 | 64,4 km | 257 | 11,6 % | 0 |
| Sörmon | MTB | 314 / 443 | 61,5 km | 227 | 14,0 % | 0 |

Stignäten är **täta**: 4–6 korsningar per km. Det är den främsta förklaringen till att genvägar sällan sparar tid.

**Marktäcke (andel av ytan, 5 m-raster):**

| | Okänd | Skog | Öppen mark | Vatten | Våtmark | Byggnad | Barriär | Bebyggd/privat |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Skutberget | 15,1 % | 30,2 % | 4,2 % | **46,3 %** | 1,3 % | 0,4 % | 0,1 % | 2,4 % |
| I2-skogen | 4,9 % | 52,8 % | 25,1 % | 3,5 % | 0,2 % | 2,1 % | 0,6 % | 10,9 % |
| Sörmon | 8,0 % | 84,6 % | 1,8 % | 3,0 % | 1,7 % | 0,1 % | 0,0 % | 0,9 % |

**Hinderdata i OSM är glest.** Mappade staket/murar/häckar: 4 st i I2-skogen, 0 i de andra. Bäckar och diken: 9 / 12 / 1. Klippor: 0. `access=private/no`: 1–2 per område. **Det betyder att "kända hinder" i praktiken är vatten och byggnader.** Okartlagda staket, tät skog och klippor kan jag inte undvika.

**Höjd:** EU-DEM 25 m i 30 × 30 punkter per område. Brant (100 m-skala): median 0,9–2,4°, p99 6,4–10,2°, max 9,4–23,6°; andel över 15°: 0,0–0,2 %. Terrängen är mjuk på den skalan. Lokala klippor under 100 m syns inte.

## 3. Terrängens framkomlighet

Vad OSM faktiskt ger och hur jag klassificerade (implementerat i `lib/raster.ts`):

| Terrängtyp | OSM-källa | Hantering | Data eller antagande? |
|---|---|---|---|
| Stigar och vägar | `highway=*` | Normal fart | Data (kvalitet varierar) |
| Skog | `landuse=forest`, `natural=wood/scrub` | Off-road tillåten (långsam) | **Polygonen är data; att den är framkomlig är antagande** |
| Öppen mark | farmland, meadow, grass, grassland, heath, park, golf, beach | Off-road tillåten | Samma |
| Vatten | `natural=water`, `waterway=riverbank`, reservoir | **Blockerad** | Data |
| Våtmark | `natural=wetland` | **Blockerad** | Data |
| Byggnad | `building=*` | **Blockerad** | Data |
| Barriärer | `barrier=fence/wall/hedge`, `natural=cliff`, järnväg, å/kanal, bäck/dike | **Blockerad** (linjer) | Data, men mycket ofullständig |
| Bebyggd/privat | residential, industrial, retail, farmyard, sportytor, trädgård | **Blockerad** (konservativt) | Antagande |
| Berg/block | `bare_rock`, `scree` | **Blockerad** | Data (sällsynt) |
| Okänd | ingen polygon | **Blockerad** i "verifierad" policy; tillåten i "permissive" | Se nedan |
| Branter | Höjddata | Inte använd | Behövs ej i dessa områden |

**Hur vi undviker sjöar, byggnader och hinder.** Tre lager: (1) rastret (5 m) avgör framkomlig klass längs hela förbindelsen; (2) en **hård mask på 1 m** över alla kända hinder, utvidgad en cell, kontrolleras längs *hela* förbindelsen utan undantag vid ändarna; (3) en **oberoende vektorkontroll** (`verify-links.ts`, exakt polygon- och linjegeometri, 0,25 m steg) som inte delar rasterkod. Resultat: **0 av 4 509** förbindelser korsar ett känt hinder (3 områden × 3 konfigurationer på MTB-graferna, inklusive stresstestet). Före åtgärderna var det 17 av 4 662 (se 7).

**Okänd terräng** är den enskilt viktigaste parametern, viktigare än hastigheten. Med okänd mark tillåten ("permissive") sparar zombier i snitt **9,3 %** restid vid Skutberget (p90 42 %), mot **0,6 %** med verifierad terräng, vid *samma* hastighet (25 %). Okänd mark är 15 % av Skutberget. Rekommendation: **okänd = blockerad**.

**Höjddata behövs inte** för grov framkomlighet i dessa områden: max ~24° på 100 m-skala. Det behövs först om man vill modellera lokala branter/klippor, vilket kräver finare data (Lantmäteriets höjdmodell) och ger troligen små effekter eftersom förbindelserna är ≤ 150 m.

**Korta förbindelser genereras automatiskt** (`lib/hybrid-graph.ts`): ankarpunkter var 40 m längs stigarna, kandidater inom maxlängd, (a) **nyttokrav**: stigvägen mellan ändarna måste vara minst 1,25 × längre i tid än off-road-vägen, (b) terrängkontroll, (c) exakt hinderkontroll, (d) högst 3 förbindelser per ankare, (e) valfri **icke-maximal undertryckning (NMS)** av nästan parallella förbindelser. Förbindelser läggs aldrig utanför rutan där data är fullständig.

**Hur grafen hålls liten.** Stigar delas bara vid ankare som faktiskt får en förbindelse; endast ~90–95 % av kandidater förkastas av nyttokravet, vilket är det som håller grafen liten. Den bärande designregeln är att **förbindelser alltid har stig i båda ändar och aldrig följer på varandra**, så att off-road-rörelse aldrig är längre än en förbindelse (se 4).

## 4. De experimentella modellerna (leverans B: teknisk genomförbarhet)

| Modell | Beskrivning |
|---|---|
| **A** | Stigbunden (nuvarande kod) |
| **B1** | Förbindelser ≤ 100 m |
| **B2** | Förbindelser ≤ 150 m |
| **B3** | Förbindelser ≤ 400 m, bara verifierad terräng. "Ingen fast gräns" är i praktiken en beräkningsgräns; 400 m valdes eftersom kandidatantalet växer kvadratiskt |
| Hastighet | 25 % (utgångshypotes), 15 %, 35 %, 50 % av stighastighet |

**Kedjegränsen (uppdragets krav).** Kravet "en längdgräns får inte kringgås genom att koppla ihop flera kanter" uppfylls strukturellt: A\*:s tillstånd är (nod, kom via off-road), och en off-road-kant får aldrig följa direkt på en annan. Varje förbindelse har dessutom stig i båda ändar. Därför är sammanhängande rörelse utanför stig **aldrig längre än en förbindelse** (≤ 100/150/400 m). Det finns ingen total off-road-budget över en rutt. Mellan två förbindelser krävs ≥ 1 stigkant (som kan vara kort), vilket i princip tillåter rutter som växlar ofta; det mättes som 0,5 byten per zombietimme vid 25 % och 3,2 vid 50 %. Låst av tester: `hybrid-hooks.test.ts` (kedja, kedja från pågående förbindelse, tid-vs-längd).

**Kan det byggas som naturlig utökning av A\*-grafen? Ja.**

- Diff i produktionskod: 9 filer, +109/−53 rader (varav `src/sim/runner.ts` +31/−11 är testverktyg). Ingen ändring av AI-beteende, state-modell eller spelregler.
- **Bevisat no-op** för stigbundna grafer: 12 simulerade matcher ger bit-identiska utfall (alla zombiepositioner, resultat, sträcka) före/efter, kontrollerat mot `master` med slutlig kod.
- Zombier får inte mer information än tidigare: AI-koden ändrades inte och använder samma observationer.
- Zombier teleporterar aldrig: byte av kant sker bara i delad nod; i alla 17 064 körningar överskred inget steg zombiens fart, och 0 av 6 480 (S1) / 0 av 3 600 (S4) / 0 av 1 944 (S3) rader hade terrängöverträdelse. S2 hade 2 av 5 040: 1–2 provpunkter i en 1 m säkerhetsmarginal, inte i själva hindret (vektorkontrollen: 0 korsningar).
- Beräkningskostnaden: se 8.

## 5. Simuleringsresultat (leverans C)

### Upplägg

Alla serier körs på de tre riktiga områdena, startposition slumpad längs stigarna per seed. Gate före skalning: `validate` (720 körningar) visade att modellerna fungerar. Fel som hittades där rättades innan de stora serierna (se 7); alla serier nedan kördes om med slutlig kod.

| Serie | Innehåll | Scenarier × modeller | Matcher |
|---|---|---|--:|
| S1 | Huvudjämförelse: 3 aktiviteter × 3 svårigheter × 5 strategier × 3 områden × 12 seeds; A, B1-25, B2-25, B3-25 | 1 620 × 4 | 6 480 |
| S2 | Hastighet (15/35/50 %), 100 vs 150 m, tillåtande terräng (+ stresstest 50 %/400 m/permissive); löpning+MTB, normal+hård | 720 × 7 | 5 040 |
| S3 | Matchlängd 20/45/60 min × täthet (glesare/normal/tätare än PRD:s antal) | 648 × 3 | 1 944 |
| S4 | Ablation: NMS 40 m | 720 × 5 | 3 600 |

**Spelarstrategier:** `random`, `avoid` (undvik närmaste zombie, ett steg), `extraction` (mot extraction när öppen), **`planner-trail`** (tre korsningar framåt, räknar bara med stigbundna zombier = vad en människa kan förutse) och **`planner-omni`** (känner zombiernas verkliga hybridrörlighet = övre gräns för en spelare som lärt sig genvägarna). Planerarna är de viktigaste: de enkla bottarna förlorar mest ändå.

### Basnivå (modell A)

Absoluta vinstnivåer beror på botarna och ska **inte** läsas som verkliga vinstsannolikheter. Relativa skillnader är informativa:

| Faktor | Vinst % (A, S1) |
|---|---|
| Svårighet | lätt 51 [47–55] · normal 23 [20–27] · svår 11 [9–14] |
| Aktivitet | promenad 46 · löpning 26 · MTB 13 |
| Strategi | random 6 · avoid 14 · extraction 38 · planerare 43 |
| Område | I2-skogen 29 · Skutberget 25 · Sörmon 32 |
| Matchlängd (S3, normal täthet) | 20 min 54 · 45 min 15 · 60 min 8 |
| Täthet (S3, 45 min) | glesare 39 · normal 15 · tätare 4 |

Svårighetsgraderna skiljer sig tydligt på verklig data. **Notera:** 39 % av infektionerna (S1, modell A; 42 % i S2/S4) sker på kanter i återvändsgrenar, som utgör 12–25 % av stiglängden. Återvändsgränder är alltså redan farliga i stigbunden AI, ungefär 1,5–3 gånger överrepresenterade.

### Huvudresultat: hybrid vs stigbunden (poolat, parvis)

| Modell | Par | Vinst A → B (%) | Δ vinst pp [95 % KI] | p (McNemar) | Δ tid under jakt (s) | Δ instängd (s) | Δ < 50 m (s) |
|---|--:|---|---|--:|--:|--:|--:|
| B1-25 | 1 620 | 28,6 → 29,3 | +0,7 [−1,4; +2,8] | 0,563 | +9 ±24 | −4,4 | 0,0 |
| **B2-25** | 2 988 | 23,3 → 24,2 | **+0,9 [−0,6; +2,3]** | 0,266 | +18 ±19 | −0,4 | +0,2 |
| B3-25 | 1 620 | 28,6 → 29,0 | +0,4 [−1,6; +2,4] | 0,762 | −7 ±23 | −2,1 | −0,1 |
| B2-15 | 720 | 7,9 → 6,1 | −1,8 [−3,9; +0,3] | 0,124 | +12 ±34 | −0,9 | +0,8 |
| B2-35 | 720 | 7,9 → 8,5 | +0,6 [−1,8; +2,9] | 0,724 | −21 ±37 | +3,9 | +1,3 |
| **B2-50** | 2 088 | 13,9 → 14,3 | **+0,4 [−1,3; +2,1]** | 0,657 | +20 ±24 | +1,2 | +1,0 |
| B1-50 | 720 | 7,9 → 5,7 | −2,2 [−4,4; −0,1] | 0,060 | −61 ±37 | +6,9 | +1,5 |
| B2-25-perm | 720 | 7,9 → 6,5 | −1,4 [−3,8; +1,0] | 0,308 | −46 ±40 | −0,9 | +0,8 |
| B3-50-perm (stress) | 720 | 7,9 → 7,5 | −0,4 [−2,7; +1,8] | 0,810 | −33 ±39 | +6,2 | +1,7 |
| B2-25-nms | 720 | 8,5 → 11,0 | +2,5 [0,0; +5,0] | 0,066 | +51 ±39 | +1,2 | +1,0 |
| B2-50-nms | 720 | 8,5 → 8,2 | −0,3 [−2,8; +2,2] | 0,914 | −6 ±41 | +2,7 | +1,5 |

(A:s vinstnivå skiljer sig mellan serierna eftersom scenariourvalet skiljer: S2/S4 består bara av löpning+MTB med normal+svår.)

**Tolkning.** Inga poolade skillnader är signifikanta på 5 %-nivån; B1-50 är gränsfall (p = 0,06, −2,2 pp). Ingen modell ger mer än ±2,5 procentenheter. 150 stratifierade tester (modell × aktivitet/svårighet/strategi/område/täthet/längd, ≥ 40 par): **7 signifikanta, väntat av slumpen ≈ 7,5**. Av de 7 gick 6 åt spelarens fördel och 1 åt motsatt håll. Det mönstret (hybrid något *lättare* i vissa delmängder) är intressant men jag kan inte skilja det från brus; i S1/S2 lutar poolade tecken svagt åt det svårare. Rapporterat som osäkert.

**Off-road-andel av zombiernas färdsträcka:** 0,15 % (B2-15) · 0,24–0,34 % (S1, 25 %) · 0,8–1,5 % (50 %) · 5,0 % (stress). **Byten stig↔terräng:** 0,5 per zombietimme (25 %), 2,8–3,2 (50 %), 3,9 (stress).

### Genvägsnytta (statisk, utan AI-dynamik)

Slumpade zombie–spelare-par på stigarna; relativ tidsbesparing (1 − hybridtid/stigtid) för par med stigtid > 60 s. Det är ett statiskt mått på vad förbindelserna kan ge, oberoende av hur AI:n beter sig (slumpade par är inte jaktsituationer).

| Område · aktivitet | Modell | Medel | p90 | Par med > 5 % bättre | Par som alls använder off-road |
|---|---|--:|--:|--:|--:|
| Skutberget · löpning | B2-25 (verifierad) | 0,6 % | 0,0 % | 3 % | 6 % |
| | B2-50 | 1,8 % | 5,9 % | 11 % | 21 % |
| | **B2-25-perm** | **9,3 %** | **42,1 %** | 25 % | 29 % |
| I2-skogen · löpning | B2-25 | 0,8 % | 1,7 % | 4 % | 15 % |
| | B2-50 | 2,4 % | 7,8 % | 18 % | 44 % |
| | B3-50-perm | 4,3 % | 13,6 % | 26 % | 49 % |
| Sörmon · löpning | B2-25 | 1,3 % | 1,6 % | 8 % | 11 % |
| | B2-50 | 3,2 % | 9,3 % | 16 % | 40 % |
| | B3-50-perm | 10,1 % | 32,0 % | 41 % | 62 % |
| Sörmon · MTB | B2-25 | 2,7 % | 8,5 % | 17 % | 30 % |
| | B2-50 | 6,1 % | 18,8 % | 33 % | 57 % |

Vid verifierad terräng och 25 % hastighet är genvägsnyttan i snitt **0,6–2,7 %**; i de glesaste näten (Sörmon, MTB) upp till p90 8,5 %. Först med 50 % eller tillåten okänd mark blir den betydande. Den sparsamma terrängen driver nyttan mer än hastighetsfaktorn.

### Hur används off-road i praktiken?

`legs.txt` (36 matcher per modell, svår, `planner-trail`): **364 av 384** ben börjar i INVESTIGATE, 19 i CHASE och 1 i PATROL. Benen vänder nästan aldrig mitt i (0 % för B2-25 och B2-50, 2 % i stresstestet), har median 52–55 m (p90 133–140 m; stresstest median 116 m, p90 326 m), varar 50–86 s (median) och zombien återgår till stig/patrull efteråt. De ser alltså ut som avsedda genvägar mot en gammal position, inte som jakt genom terrängen. Detta är det som bäst förklarar nollresultatet.

### Spelarens kunskap om genvägar

`planner-trail` (förutser inte genvägar) mot `planner-omni` (känner dem): vid 50 % (S2, 144 par per bot) faller trail från 16,0 → 10,4 % (B2-50) och omni 16,0 → 11,1 %, båda icke-signifikanta (p = 0,15 / 0,21). Skillnaden mellan dem är liten. Att inte kunna förutse off-road kostar alltså nästan inget extra. **Jag hittar ingen "orättvisa överraskningar" i data, men bottarna reagerar inte som människor.**

### Mått för mått (frågeställningarna i uppdraget)

| Mått | Resultat | Typ |
|---|---|---|
| Vinstfrekvens | Oförändrad inom ±2,5 pp i alla modeller (se ovan) | Mätt |
| Tid till infektion | Poolad Δ −61…+51 s på ett jaktfönster där median tid till infektion är ~16–20 min; ingen konsekvent riktning | Mätt |
| Minsta zombieavstånd / kritiska situationer | Δ tid inom 50 m: −0,1…+1,7 s per match; vid 50 %/stress + ~1,0–1,7 s (ca 10 % över basvärdet 10–12 s) | Mätt |
| Off-road-andel | 0,15–1,5 % av färdsträckan (säkra modeller), 5 % (stress) | Mätt |
| Genvägsnytta | 0,6–2,7 % (25 %, verifierad), 1,8–6,1 % (50 %), upp till 13 % (tillåtande/stress) | Mätt |
| Återvändsgränder | Andel infektioner i återvändsgren 39 % (A) mot 39–41 % (B 25 %), 45–46 % (50 %/stress): marginell ökning vid hög fart | Mätt, osäker |
| Extraction | Δ marginal (zombiers ankomst minus spelarens): poolat −6…+12 s, i delmängder −54…+70 s, utan konsekvent riktning; extraction-sökande strategier: A 37,7 → B2-25 39,8 % (p = 0,46) | Mätt |
| Vägvalsvariation | Spridning av zombiernas ankomstvinkel: Δ −3,1…+4,5 på en 0–100-skala, ingen konsekvent ökning. **Proxy, inte taktiskt intresse.** | Proxy |
| Oundvikliga situationer ("instängd": båda utgångar från spelarens kant nås av en zombie före spelaren) | Δ −4,4…+9,7 s per match på basvärdet 29–53 s; vid 50 %/stress +5…+7 s | Proxy |
| Beräkningskostnad | Se 8 | Mätt |

### Ablation: NMS

NMS (40 m) halverar eller mer antalet förbindelser (t.ex. I2-skogen B2-50: 965 → 367) och minskar genvägsnyttan marginellt (2,4 → 2,2 % medel). I spelutfall är B2-25-nms och B2-50-nms inte skilda från sina motsvarigheter. **NMS rekommenderas** för att minska grafstorlek och visuellt brus (se skärmdumparna i `report-assets/`).

## 6. Spelmekanisk bedömning (leverans D)

Ingen modell skapar *mätbart* bättre balans mellan jakt, taktik och rättvisa. Allt som går att mäta (vinst, överlevnadstid, kritiska situationer, extraction, instängdhet) ligger inom bruset vid de parametrar som är säkra att införa. Tre saker går att säga:

1. **Rättvisa:** Inget tyder på att hybrid gör spelet orättvist. "Instängd" ändras −4…+7 s per match mot basvärdet 29–53 s (B1-50 +6,9, stresstest +6,2, B2-50 +1,2 poolat). Extraction blir inte svårare.
2. **Taktik:** Inget tyder på att hybrid gör spelet taktiskt rikare, eftersom genvägarna används mot gamla positioner. Den mekanism som skulle skapa taktiska situationer (zombier som genar *under jakt*) är nästan inte aktiv.
3. **Förutsägbarhet:** Spelare som inte känner till genvägar förlorar nästan inte mer än de som gör det.

**Vilken modell?** B1/B2/B3 är oskiljbara vid 25 %. Om hybrid ändå införs är **B1 (100 m)** minst riskabel: minst graf, kortast ben, samma utfall.

## 7. Risker och oönskade effekter (uppdragets punkter 1–7)

### Identifierade fel (hittade och rättade under studien)

| # | Fel | Konsekvens | Åtgärd |
|---|---|---|---|
| 1 | OSM-API:ts `/map` ger ofullständiga multipolygon-relationer (21 av 35 var ofullständiga, inklusive Vänern med 4 141 medlemmar, bara 3–4 i rutan) | **Sjön hade saknats** vid Skutberget/Sörmon: en naiv implementation hade låtit zombier gå över Vänern | Kompletterade 19 via `/full`; Vänern sluts mot rutans kant med vattensida vald där sidan nästan saknar vägnoder. Det är en **heuristik** (kontrollerad: <0,06 % av stigpunkterna hamnar i vatten/byggnad), inte OSM-geometri |
| 2 | Samplingssteg 5 m kunde hoppa över 2 m breda staket | Förbindelser korsade tunna hinder | Steg 1 m, sedan exakt maskkontroll |
| 3 | Exakt vektorkontroll visade att förbindelser kunde korsa hinder *inom 8 m från ändarna* (jag hade undantagit stigkorridoren) | 17 av 4 662 korsade byggnader/järnväg/våtmark | Hela förbindelsen kontrolleras utan undantag |
| 4 | Förbindelser kunde läggas utanför datarutan (stigar sticker ut över kanten) | I stresskonfigurationen korsade 6 länkar IKEA-byggnaden, som delvis ligger utanför rutan | Förbindelser får bara ligga inom rutan där data är fullständig |
| 5 | Verkliga enkelriktade MTB-stigar skapade noder utan utgång; den simulerade spelaren kraschade | Syntetiska nät hade aldrig det fallet | Spelaren vänder (testverktyg) |

Slutlig status: **0 av 4 509** förbindelser korsar ett känt hinder (exakt vektorkontroll, 3 områden × 3 konfigurationer). Kontrollen delar OSM-polygonerna med generatorn, så den visar frånvaro av *kända* hinder, inte av verkliga.

### Simulerade risker

| Risk | Resultat |
|---|---|
| 1. Zombier genar över vatten/hinder | 0 kända hinder korsade; **men okända hinder (staket, tät skog, klippor) är oadresserade** |
| 2. För många oförutsägbara anfallsvinklar | Ingen mätbar ökning (Δ ankomstspridning ≈ 0); 19 av 384 ben börjar i CHASE |
| 3. Omringning | "Instängd" −4…+7 s per match (B1-50 +6,9 · stresstest +6,2 · B2-50 +1,2 · B2-25 −0,4), basvärde 29–53 s |
| 4. Extraction praktiskt omöjlig | Ingen effekt |
| 5. Alltför täta byten stig/terräng | 0,5/zombietimme (25 %), 3,2 (50 %). Låga; inga avbrutna ben |
| 7. Hybridgrafen för resurskrävande | Nej: se 8 |

### Risker som bara kan avgöras i fält

- **6. Spelaren lockas lämna stigar/fatta riskfyllda beslut.** Ritas zombier genom skogen kan spelare tolka det som att terrängen är framkomlig/tillåten. Det här är den allvarligaste risken (jfr PRD 17). Jag kan inte mäta den i simulering. **Rekommendation: ingen hybrid för MTB och promenad i första versionen**, ritning av off-road i dämpad stil.
- Läsbarhet av off-road-zombier på liten mobilkarta.
- Upplevd naturlighet.
- Att okända hinder (staket, undervegetation, klippor) gör rörelserna orimliga.

## 8. Arkitektur och dataeffektivitet

| Mått (löpning) | A | B2-25 | B2-25-NMS | B2-50 | B3-50-perm (stress) |
|---|--:|--:|--:|--:|--:|
| Skutberget JSON (kB) / gz | 111 / 21 | 177 / 31 | 146 / 27 | 262 / 44 | 398 / 64 |
| I2-skogen JSON / gz | 320 / 60 | 465 / 83 | 394 / 74 | 775 / 134 | 862 / 146 |
| Sörmon JSON / gz | 165 / 30 | 362 / 61 | 274 / 50 | 609 / 100 | 662 / 107 |
| Heap efter inläsning (MB, I2) | 1,3 | 2,8 | 2,5 | 4,5 | 4,9 |
| A\*-tid per rutt (ms, I2) | 0,36 | 0,63 | 0,50 | 1,66 | 1,73 |
| Hybridgrafsbyggnad (ms, Node) | – | 159 | 200 | 149 | 380 |

Förberedelse från fixtur (raster 5 m + mask 1 m + generering, Node, kall JIT): Skutberget 0,7 s, I2-skogen 1,0 s, Sörmon 0,3 s. Simulering: CPU per match (45 min, motorn) ≈ 0,3 s för A mot 0,5–0,9 s för B (≈ 2–3×), dvs. ≈ 0,02–0,07 ms per 5 Hz-steg i Node.

**Slutsatser för PWA-arkitekturen:**

- **Generera på servern, inte klienten.** Klienten skulle behöva terrängpolygonerna (0,6–1,4 MB rå JSON, 85–250 kB gz) för att generera, vilket är *större* än den färdiga hybridgrafen (30–134 kB gz). Servern (Next.js route handler) bygger grafen en gång per bbox och aktivitet, svaret cachas hos Vercel och i IndexedDB (`terrainCache`).
- **Ingen ny extern tjänst.** Men terrängdatan kräver en större Overpass-fråga (landuse/natural/building/waterway), och produktion ska inte bero på publika Overpass-instanser (jfr PRD 10.3); under den här studien var alla nio publika instanser jag provade otillgängliga, trasiga, begränsade till vitlistade användare eller regionala. Regionalt OSM-extrakt är det robusta alternativet.
- **Minne/CPU är inget problem** för en mobil-PWA: < 1 MB graf, < 5 MB heap, < 2 ms per A\*-rutt.
- **Licens:** hybridgrafen är en härledd databas från OSM. ODbL share-alike kan gälla; kräver bedömning före produktion.

## 9. Rekommenderade parametrar (leverans E)

*Om* hybrid införs (senare version), begränsad:

| Parameter | Rekommendation | Motiv |
|---|---|---|
| Off-road-hastighet | **25 %** | 15 % ger 0,15 % off-road-andel och ingen effekt; 35–50 % ger mer off-road (0,8–1,5 %) och upp till +7 s instängd utan mätbar vinst |
| Max genvägslängd | **100 m (B1)** | Oskiljbar från 150/400 m, men minst graf och risk; kedjegräns kvar |
| Tillåten terräng | Verifierad skog och öppen mark; **okänd = blockerad**; vatten, våtmark, byggnad, barriär, bebyggt/privat, berg blockerade; bäckar blockerade | Okänd mark ger 15× större genvägsnytta vid Skutberget, alltså mest osäkerhet |
| Ankare / nytta | 40 m, minst 1,25 × tidsvinst, max 3 per ankare, **NMS 40 m** | Halverar graf |
| Aktiviteter | **Bara löpning**; ej MTB (säkerhet, snabba rörelser), ej promenad (0,6 km/h off-road är meningslöst) | Se 7 |
| Svårighetsanpassning | **Ingen** | Ingen mätbar effekt; kopplar man hybrid till svårighet ändrar man dessutom Svår på ett sätt som inte syns i data |
| Zombie-tillstånd | Som nu: bara INVESTIGATE/CHASE/INTERCEPT, aldrig PATROL | Utfallet blev 95 % INVESTIGATE (364/384), 0–2 % vändande ben |

## 10. Rekommenderad implementation (leverans F)

Minsta kodändringar för att införa vald modell (redan gjorda och testade på grenen, no-op för stigbundna grafer):

| Fil | Ändring |
|---|---|
| `src/geo/graph/types.ts` | `RawEdge.offroad?`, `speedFactor?`, `GraphNode.virtual?`, `TrailGraph.trail?` |
| `src/geo/graph/graph.ts` | `indexGraph` bygger `trail`-vy; `trailOf()`; `snapToGraph`/`nearbyEdges`/`degreeOf`/`posAtNode` använder spelarvyn |
| `src/engine/pathfinding/astar.ts` | Hastighet × `speedFactor`; kedjeregel via tillstånd (nod, kom via off-road) |
| `src/engine/core/movement.ts` | Patrull väljer inte förbindelser |
| `src/engine/core/engine.ts` | Zombiefart × kantens `speedFactor` |
| `src/engine/ai/zombie-ai.ts` | Observation, riktning och korsningar använder spelarvyn |
| `src/engine/extraction/extraction.ts`, `spawning/spawn.ts` | Spelarvy; aldrig virtuella noder; spawn på stigkanter |

Det som återstår för produktion (inte gjort): (1) flytta generatorn (`lib/raster.ts`, `lib/blockers.ts`, `lib/hybrid-graph.ts`) till `src/geo/hybrid/` med webbläsarsäkra beroenden, (2) terrängfrågor i `/api/terrain` och server-side generering, (3) grafformat med `offroad`-kanter i API-svaret och IndexedDB, (4) valideringstester mot verkliga fixturer (finns i `hybrid.test.ts`), (5) licensbedömning, (6) fälttest.

## 11. Beslutsunderlag (leverans G)

| Alternativ | Bedömning |
|---|---|
| **1. Behåll stigbunden AI** | Rimligt standardval. Inget i data kräver hybrid. Risk: realism-vinsten, som inte kan mätas här, går förlorad |
| **2. Begränsad hybrid-AI nu** | Tekniskt säkert vid 25 %/100 m/verifierad terräng och billigt (< 100 kB gz). Men: ingen mätbar nytta, kräver terrängdata i API, nytt datalager och licensbedömning, och riskerar att locka spelare från stigarna. **Inte motiverat före v1** |
| **3. Senare version (rekommenderas)** | Hakarna finns redan och kostar ingenting att behålla. Besluta efter fälttest |

**Utlösare för att bygga (alternativ 3 → bygga):** minst ett av (a) fältspelare/testare beskriver zombierna som "räls"/förutsägbara, (b) fälttest visar att spelare utnyttjar återvändsgrenar systematiskt (39–42 % av infektionerna sker där redan idag mot 12–25 % av stiglängden), (c) ett område med mycket glest nät där stigbundna zombier inte når spelaren. Annars: alternativ 1.

**Förutsättningar för att hybrid ska få införas:** ingen MTB-hybrid utan separat säkerhetsgranskning; okänd mark blockerad; dämpad off-road-visualisering; kedjegräns kvar.

**Osäkerheter som kan ändra beslutet:**

1. Bottarna är inte människor. En människa som ser en zombie i terrängen kan reagera annorlunda (panik, fel beslut). *Fälttest.*
2. Tre områden i samma stad, alla täta. Glest nät (norra Värmland) kan ge helt annan genvägsnytta.
3. OSM-hinderdata är gles. I verkligheten finns staket, tät skog och klippor som zombierna "går igenom". Det påverkar inte spelet fysiskt men kan påverka trovärdighet.
4. Poolade effekter är små men inte noll-bevisade: konfidensintervallen är ±2 pp.
5. Stresskonfigurationen (50 %, 400 m, okänd mark) visar att effekten *växer* med dessa parametrar (upp till 12 % genvägsnytta), men det är långt utanför det som är säkert.

## 12. Reproducerbarhet

```bash
node experiments/hybrid/fetch-osm.mjs && node experiments/hybrid/complete-relations.mjs   # fixturer (finns incheckade)
node experiments/hybrid/fetch-elevation.mjs
npx tsx experiments/hybrid/profile-terrain.ts      # marktäcke
npx tsx experiments/hybrid/verify-links.ts         # oberoende hinderkontroll (ca 10 min)
npx tsx experiments/hybrid/graph-stats.ts          # storlek, minne, A*-tid, genvägsnytta
experiments/hybrid/run-all.sh                      # S1–S4 i 4 skärvor (~1 h på 4 kärnor); återupptar
npx tsx experiments/hybrid/tables.ts s1 model paired   # tabeller; pooled.ts för poolat
npx tsx experiments/hybrid/export-viz.ts && npm run dev   # /dev/hybrid
npm test                                           # 85 tester (inkl. hybridinvarianter på riktiga fixturer)
```

Resultatfiler (`results/*.jsonl`) hålls utanför git men återskapas deterministiskt; sammanfattningar finns i `results/tables.md`, `graph-stats.txt`, `legs.txt`, `terrain-profile.txt`, `verify-links.txt`. Skärmdumpar: `report-assets/`.

Ej gjort: fälttest, test på fysisk enhet, GPS-brus i hybridserierna (alla körningar har perfekt GPS), andra områden än Karlstad, finare höjddata, jämförelse med sparsamma nät.
