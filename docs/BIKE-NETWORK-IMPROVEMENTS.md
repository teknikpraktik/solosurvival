# Cykelläge: nätverksval och spelare utanför nätet

Gren: `feature/bike-network-improvements` (från `master` efter PR #42, commit `224f907`). Underlag: `docs/OFFTRAIL-BIKE-ADDENDUM.md` och `docs/OFFTRAIL-UTREDNING.md` (grenarna `docs/offtrail-bike`, `docs/offtrail-investigation`).

Etiketter: **[fakta]** läst i koden eller mätt på de riktiga Värmlandstilesen, **[sim]** simulering med boten "planner" (inte människor), **[antagande]**, **[telefon]** kräver fysisk mobil. Ingen funktion har provats på en telefon.

## 1. Sammanfattning

| Fråga | Resultat |
|---|---|
| Förbättrar ett annat komponentval cykelstarter? | **Nej, inte på ett sätt som motiverar en ändring.** 600 starter på riktiga tiles, sex regler: bästa regeln ändrar utfallet för 1 av 600 cykelstarter (och 4 av 600 till fots) och försämrar ingen. Standardregeln behålls (`nearest`). Det tidigare påståendet "27 av 60 starter hade en större del att välja" var missvisande (avsnitt 3). |
| Varför misslyckas starter då? | 66 av 101 misslyckade cykelstarter står på en **kort isolerad väg (< 1,5 km)**; 35 av 101 har ett nät under 3 km. Spelaren får idag ett felaktigt budskap ("närmaste stig är X m bort"). |
| Meddelande och val | **Införd.** Cykel utan tillräckligt nät ger ett begripligt meddelande och två knappar: *Try from my position* och *Switch to walking*. Spelet byter aldrig läge själv. |
| Cyklist utanför vägnätet | **Införd i begränsad form** (regelversion 2.3.0, bara cykel): klassificering med GPS-hänsyn och hysteres, budget 90 s per ca 5 min, därefter kan en zombie som väntar vid närmaste väg smitta. Ingen zombie lämnar nätet. Gångläget är oförändrat. |
| Gap links | **Inte implementerade.** 250 m-länkar löser 8 procentenheter av cykelstarterna men 70 % av länkarna ligger vid ett hinder; utan terrängunderlag motiverar det inte fortsatt utveckling nu. |
| Off-trail-hastigheter | Analyserade, **inte** införda. |
| Regression | 108 simulerade matcher (gång/cykel × 3 svårigheter × 3 lägen × 6 seeds) och 160 `prepareMatch`-anrop på riktiga tiles ger **identiska** resultat på `master` och grenen. 348 tester gröna. |
| Rekommendation | **Villkorat GO för merge**, NO-GO för produktion före telefonprov (avsnitt 10). |

## 2. Hur komponentvalet fungerar idag [fakta]

`src/data/region-graph.ts`, `assemble()`: nätet inom radien (cykel Survival ca 6 km) delas i sammanhängande delar (komponenter). För varje del beräknas närmaste kant till startpunkten och delens längd. Delar på minst **1,5 km** (`MIN_COMPONENT_M`) är användbara; **närmaste användbara del väljs**, och finns ingen på 1,5 km väljs den närmaste överhuvudtaget. Därefter gäller:
- start inom 150 m från den valda delen (`MAX_START_SNAP_M`), annars `off_network`;
- Survival kräver minst 3 km sammanhängande (`sparse`);
- Mission/A TO B kräver att checkpoints respektive väg kan läggas (`no_route`).

Valet är nu utbrutet till den rena funktionen `pickComponent(kandidater, regel)` (deterministisk, oberoende av kandidatordning), så att alternativen kan mätas. Standardregeln är oförändrad.

## 3. Jämförelse av regler på riktiga data [fakta]

Metod: `scripts/bike-network-eval.ts`. 600 slumpade starter per aktivitet; i varje start väljs en slumpad tillåten väg i en slumpad tile, och spelaren står på vägen, 40 m eller 100 m från den (GPS ligger sällan exakt på en väg). Samma startpunkter för alla regler. Per start och regel körs den riktiga `prepareMatch` för Survival och Mission med standardparametrar (cykel 45 min / 10 km, gång 30 min / 3 km). Urvalet är tile-viktat, inte befolkningsviktat, och bara ett bidrag per tile-slump.

Regler: `nearest` (nuvarande), `largest150/300/500` (längsta användbara del inom N m), `scored` (poäng = min(längd, 30 km) / (1 + (avstånd/150 m)²) inom 500 m), `scored150` (samma inom 150 m).

**Cykel (n = 600)**

| Regel | Survival godkänd | Mission inom tolerans | Mission ok eller "alternativ" | Extraction går att placera (av godkända) | Median nät km |
|---|---|---|---|---|---|
| **nearest (nu)** | **499 (83,2 %)** | 302 | 468 | 479/499 | 44,9 |
| largest150 | 500 (83,3 %) | 307 | 469 | 480/500 | 45,5 |
| largest300 | 493 (82,2 %) | 304 | 451 | 474/493 | 46,6 |
| largest500 | 470 (78,3 %) | 298 | 425 | 451/470 | 50,0 |
| scored | 499 (83,2 %) | 305 | 460 | 480/499 | 45,1 |
| scored150 | 500 (83,3 %) | 305 | 469 | 480/500 | 45,0 |

Mot `nearest`: `largest150` förbättrar 1 start och försämrar 0 (5 får ett minst 1,2 gånger längre nät); `largest300` förbättrar 1 och **försämrar 7**; `largest500` förbättrar 1 och **försämrar 30**; `scored` förbättrar 1 och försämrar 1; 463–496 av 600 starter ger exakt samma val.

**Gång (n = 600)**: `nearest` 462 (77,0 %), `largest150` 466, `scored` 466, `scored150` 466, `largest300` 459, `largest500` 454. `largest150` förbättrar 4 och försämrar 0.

**Varför blir större fönster sämre?** En större del 150–500 m bort ligger utanför startgränsen på 150 m, och spelaren får då `off_network` trots att en användbar del fanns närmare. Extraktions- och checkpoint-placeringen var oförändrad (480/500 mot 479/499). Återvändsgränder (median andel 0,46–0,47 av längden) och cykelkomplexitet (median 9) skiljer sig inte mellan reglerna.

**Slutsats [fakta].** Komponentvalet är inte flaskhalsen. Den bästa regeln (`largest150`/`scored150`) är aldrig sämre, men ändrar 1–4 av 600 starter, vilket inte är en tydlig förbättring och skulle ändra gångläget. **Standardregeln behålls.** Valfunktionen och mätskripten finns kvar så att en regel kan väljas om datan ändras. Motargument: en regel som aldrig försämrar och ibland förbättrar kostar nästan ingenting; jag avstår eftersom nyttan (≤ 0,7 % av starterna) inte motiverar att ändra något som även gäller gångläget.

**Rättelse av tidigare påstående.** Addendumet på `docs/offtrail-bike` angav att den valda delen var mindre än 90 % av den största inom radien i 27 av 60 cykelstarter. Det jämförde med den största delen *var som helst* inom 6 km, inklusive delar som ligger långt utanför de 150 m där spelaren faktiskt kan starta. Mätningen här (samma startpunkter, avståndsgräns) ger 7 av 600.

**Vad misslyckandena egentligen är (nearest, kandidatlistor från körningen).**

| | Cykel | Gång |
|---|---|---|
| Misslyckade Survival-starter | 101 av 600 (16,8 %) | 138 av 600 (23,0 %) |
| `off_network` | 66 – alla har en del inom 150 m men **kortare än 1,5 km** (spelaren står alltså på en kort väg) | 64 (61 av dem likadant; 3 utan någon del inom 150 m) |
| `sparse` (< 3 km sammanhängande) | 35 (median 2,3 km) | 74 (median 2,2 km) |
| …varav har en del ≥ 3 km på 150–500 m | 45 av 101 | 38 av 138 |

## 4. Införda förbättringar

1. **Cykel utan tillräckligt nät** (`prepare.ts: bikeNetworkAdvice`, `NewGame.tsx`). Statusarna `off_network`, `sparse` och `no_route` i cykelläge ger: *"There are not enough rideable roads here for a bike match. [Närmaste sammanhängande nät är ca N m bort.] [Bara ca X km sammanhängande väg inom räckhåll.] Choose another start, or switch to walking."* Knapparna *Try from my position* (förbereder om från aktuell GPS-position) och *Switch to walking* (förbereder samma läge i gångläge, bara efter knapptryck). Gångläge och lyckade förberedelser rörs inte. Alla 101 misslyckade cykelstarter i mätningen får nu detta meddelande.
2. **Spelare utanför nätet (cykel)** (`engine/offnetwork.ts`, motorn, sessionen, `Play.tsx`) – se avsnitt 6.
3. **Komponentvalet** är utbrutet till `pickComponent` med oförändrat beteende, bevisat med fingeravtryck (avsnitt 8).
4. **Mät- och regressionsverktyg:** `scripts/bike-network-eval.ts`, `gap-link-analysis.ts`, `offtrail-speed-analysis.ts`, `regression-fingerprint.ts`, `prepare-fingerprint.ts`.

Regelversionen är nu **2.3.0**: matcher sparade före ändringen återupptas inte (samma mekanism som 2.2.0). En match utan `offNetwork`-fält kan ändå fortsätta utan fel (testad).

## 5. Vad som händer i dag när cyklisten lämnar nätet [fakta]

Motorn snappar spelaren till närmaste kant oavsett avstånd och zombierna jagar den snappade punkten (magnet, 2 000 m för cykel). De stannar alltså inte och tappar inte målet. Men infektion kräver att zombien är inom 20 m fågelvägen (och nåbar längs nätet, v2.2), och en zombie som står vid närmaste vägpunkt kan inte komma närmare än spelarens avstånd från vägen. **En spelare som står 50 m från vägen var därför osmittbar, hur länge som helst.** Det är exploiten. (Bevis: gångläget har oförändrad kod, och samma scenario i testet "gångläge påverkas inte" ger ingen smitta på 400 s.)

## 6. Off-network-hantering

**Regel (bara cykel; `rules.offNetworkExposure`).**
1. *Klassificering.* Effektivt avstånd = avstånd till närmaste vägpunkt − min(GPS-osäkerhet, 25 m). Spelaren räknas som utanför nätet när det effektiva avståndet är ≥ 40 m i minst 8 s i följd; tillbaka först när det är ≤ 25 m i 3 s (hysteres). Positioner med sämre noggrannhet än 40 m ändrar inget läge.
2. *Budget.* 90 s utanför nätet; fylls på 0,3 s per sekund på nätet (full på ca 5 min). Tidigare tid utanför påverkar alltså inte en vanlig avstickare, ett kartstopp eller en omappad väg.
3. *Exponering.* När budgeten är slut och spelaren fortfarande är utanför kan en zombie som **väntar** vid den närmaste nätpunkten (≤ 25 m, med samma nätkontakt som vid vanlig infektion, så en zombie på andra sidan en barriär räknas inte) smitta med vanlig infektionstid (3 s, 5 s vid sämre GPS). Zombierna rör sig fortfarande bara på nätet; ingenting flyttas, hoppar eller korsar något.
4. *Visning.* Pillret "Off the road network · N s until zombies find you" (och "Off the road · zombies can reach you. Return to a road!" när budgeten är slut), ljud/vibration vid inträde och vid exponering, och fältloggen (`off_network` med budget och avstånd).
5. *Återkomst.* Normal jakt: zombierna har hela tiden jagat den snappade punkten; testet visar att ingen zombie rör sig mer än en stegs längd per steg, och att läget slås av efter 3 s nära nätet.

**Mätning [sim, deterministisk enhetssimulering].**

| Scenario | Före (2.2) | Efter (2.3) |
|---|---|---|
| Står 50 m från vägen, zombie väntar vid vägen | aldrig smittad (400 s testat) | smittad efter ca 101 s (8 s + 90 s + 3 s) |
| Går utanför 70 s, tillbaka 20 s, upprepat | aldrig smittad | smittad inom 6 cykler |
| 25 m från vägen med ±5 m brus i 5 minuter | – | läget slås aldrig på |
| Gångläge, samma scenario | oförändrat | oförändrat |

**GPS-brus (falska "utanför nätet" på vägen, 20 körningar × 2 h, AR-korrelerat brus):** σ 5 m (noggrannhet 8) 0, σ 10 m (15) 0, σ 15 m (25) 0, σ 25 m (40) 8 falska inträden men **0 exponeringar** (budgeten räcker och fylls på), σ 40 m (60, ignoreras) 0. **Latens för verklig avvikelse (noggrannhet 8 m):** 45 m från vägen utlöser aldrig läget (effektivt 37 m); 60 m eller mer: inträde efter 8,0 s, exponering efter 98 s.

**Dismount-principen [analys, ej införd som egen regel].** Att behandla en spelare utanför nätet som fotgängare vore konsekvent men kräver att zombierna kan *röra sig* utanför nätet (annars ändras inget) – alltså terrängnavigering. Budgetmodellen ovan är den minsta sak som tar bort permanent osmittbarhet utan att zombier rör sig utanför nätet. Den införda regeln bygger på samma princip som bakgrundsläget (skydd med budget).

**Nya exploiter och orättvisor jag har hittat [fakta/analys]:**
- *Budgetcykling*: upp till 90 s av var 5:e minut (30 %) kan tillbringas utanför utan risk. Det är tänkt (kartstopp), men är en fördel mot spelare som aldrig lämnar vägen.
- *Falsk infektion*: en zombie "når" en spelare som står i en sjö, en byggnad eller bakom en å, eftersom spelet saknar terrängdata. Regeln slår till först efter 98 s utanför och bara om en zombie väntar vid vägen. Den som tar en längre paus (fika, toalett) ska pausa spelet; det finns en PAUSE-knapp.
- *Omappade vägar*: en cyklist på en verklig men omappad väg räknas som utanför nätet. Det är en datafråga; budgeten dämpar men eliminerar inte felet. Andelen går inte att mäta utan fältdata.
- *Detektering*: avstånd under ca 48 m (40 m + noggrannhetsavdrag) räknas aldrig. En spelare som står 40 m från vägen är fortfarande osmittbar. Jag har inte sänkt tröskeln eftersom 25–45 m är där GPS-felet och verkliga vägavvikelser (cykelbanor, parallella gator) blandas.

## 7. Säkerhets- och GPS-begränsningar

- Alla avstånd bygger på GPS med 5–20 m fel; reglerna drar av upp till 25 m osäkerhet och använder tidströsklar, men ett genomgående dåligt GPS-läge (över 40 m) frysar klassificeringen i stället för att avgöra den.
- Terräng, vatten, byggnader och privat mark finns inte i tilesen. Därför flyttas ingen zombie utanför nätet, och regeln ger aldrig en rutt eller ett mål utanför det.
- Meddelandena och knapparna uppmanar aldrig spelaren att lämna en väg eller korsa en trafikled.
- **[telefon]** Hur pillret och ljuden upplevs, och om klassificeringen stämmer med verkliga cykelturer med typiska GPS-förhållanden, är inte provat.

## 8. Tester och simuleringsresultat

**Automatiskt verifierat [fakta]:**

| Kontroll | Resultat |
|---|---|
| `tsc --noEmit`, `npm run lint` | rent |
| `vitest run` | **31 filer, 348 tester gröna** (329 före etappen; 19 nya i `bike-network.test.ts`) |
| `next build` | lyckas |
| E2E headless Chromium | `play` 16/16, `atob` 7/7, `capture` 5/5, `background` 6/6, `viewzoom` fot 11/11, cykel 11/11 |
| Fingeravtryck, 108 simulerade matcher (gång/cykel × lätt/normal/svår × survival/A TO B/mission × 6 seeds) | **identiska** på `master` och grenen |
| Fingeravtryck, 160 slumpade starter × Survival + Mission (`prepareMatch`, riktiga tiles, gång och cykel) | **identiska** (123 av 160 ok i Survival+Mission) |

Nya enhetstester: komponentval (flera delar nära start, stor men avlägsen del, små isolerade delar, inget lämpligt nät, deterministiskt oberoende av ordning); cykelmeddelandet (alla tre statusar, ok/alternativ/gång orörda); klassificeringen (brus, dålig noggrannhet, kort avvikelse, hysteres, budget och påfyllning); motorn (exponering efter budget, gång oförändrat, brus nära vägen, barriär, återkomst utan hopp, budgetcykling, sparad match utan fält, alla tre lägen). Checkpoint- och extraction-placering är mätt på riktiga data (avsnitt 3) i stället för i ett eget enhetstest.

**Kräver fysisk mobil [telefon]:** pillrets och ljudens läsbarhet, att "Switch to walking" känns rätt i flödet, klassificering på riktiga turer (omappade vägar, skog, byggnader), batteri och prestanda (regeln är O(1) per steg: inget extra nätsnap).

## 9. Gap links: utredning, ej införd

Metod: `scripts/gap-link-analysis.ts`, samma 600 starter per aktivitet. Alla delar vars närmaste noder ligger inom G m slås ihop (zombie-only); Survival-kriteriet (start ≤ 150 m, ≥ 3 km) mäts om. En länk är **hinderangränsande** om någon ändnod är en hindernod (stigen tar slut vid större väg, järnväg eller vatten); tilesen skiljer inte på typ.

| Gap | Cykel: godkända (alla länkar) | …fixade / försämrade | Länkar per start, andel hinderangränsande | Cykel, bara länkar utan hinder | Gång: fixade (alla / utan hinder) |
|---|---|---|---|---|---|
| 0 m (nu) | 499 (83,2 %) | – | – | – | – |
| 25 m | 510 | 11 / 0 | 14,4 · 90 % | 499 (fixade 0) | 13 / 0 |
| 50 m | 517 | 18 / 0 | 20,9 · 83 % | 502 (3) | 20 / 4 |
| 100 m | 527 | 29 / 1 | 32,2 · 77 % | 505 (6) | 35 / 9 |
| 250 m | 548 (91,3 %) | 49 / 0 | 51,3 · 70 % | 524 (25) | 61 / 27 |

(Gång: 462 godkända utan länkar; med 250 m 523.) Risker som listats: vatten, motorvägar, järnvägar och planskilda korsningar syns inte i datan; byggnader och privat terräng likaså. Länken måste få egen hastighet och verifierad framkomlighet. **Bedömning:** mellan 4 och 8 procentenheter på cykel vid 250 m, men den säkra delen är bara hälften och förutsätter ett terrängunderlag som inte finns. Det **motiverar inte fortsatt utveckling nu**; de 66 starter på korta isolerade vägar löses bättre av meddelandet och valet (avsnitt 4). Ta upp igen när hindertyp i tilesen (`k`, v2.2) och en terrängmask finns.

## 10. Off-trail-hastigheter (analys, ej aktiva regler)

Preliminära värden Lätt 2,5 / Normal 3,5 / Svår 4,5 km/h för zombier överallt, helt öppet gitter utan hinder, 24 matcher per rad, planner. **Inte införda.**

**Till fots (30 min)**

| Zombier | Spelare | Överlevde | Levande efter 10 min |
|---|---|---|---|
| Lätt 2,5 | gående 4,7 / 3,8 / jogg 8 km/h | 100 % / 92 % / 100 % | 100 % |
| Normal 3,5 | gående 4,7 / 3,8 / jogg 8 | 88 % / 92 % / 92 % | 100 % |
| Svår 4,5 | gående 4,7 | 17 % (7–36) | 75 % |
| Svår 4,5 | långsam gående 3,8 | 0 % (0–14) | 50 % |
| Svår 4,5 | jogg 8 | 79 % (60–91) | 100 % |

**Cykel (45 min)**

| zombies off-trail | player | survived 45 min | alive after 10 min |
|---|---|---|---|
| easy 2.5 km/h | cyclist 16 km/h | 96% (80–99) | 100% (86–100) |
| easy 2.5 km/h | slow cyclist 10 km/h | 92% (74–98) | 100% (86–100) |
| easy 2.5 km/h | pushing the bike 5 km/h | 75% (55–88) | 100% (86–100) |
| normal 3.5 km/h | cyclist 16 km/h | 92% (74–98) | 100% (86–100) |
| normal 3.5 km/h | slow cyclist 10 km/h | 96% (80–99) | 100% (86–100) |
| normal 3.5 km/h | pushing the bike 5 km/h | 58% (39–76) | 100% (86–100) |
| hard 4.5 km/h | cyclist 16 km/h | 100% (86–100) | 100% (86–100) |
| hard 4.5 km/h | slow cyclist 10 km/h | 88% (69–96) | 100% (86–100) |
| hard 4.5 km/h | pushing the bike 5 km/h | 38% (21–57) | 100% (86–100) |

Bedömning [sim]: **Svår riskerar inte att bli för lätt utanför nätet för en gående** (4,5 km/h är i nivå med gånghastigheten, 17 % klarar sig), men är lätt för joggare (79 %) och cyklister (88–100 %); den som leder cykeln (5 km/h) klarar 38 %. Lätt och Normal ger 88–100 % överlevnad för alla utom den som går med cykeln, så off-trail-zon blir i praktiken en fristad; farligheten måste därför ligga på vägarna, vilket stämmer med principen att cykelläget är vägbundet. Motargument: gittret saknar hinder och använder en enda bot; med verkliga hinder kan vägen vara längre och siffrorna bättre för zombierna, eller sämre om spelaren fastnar.

## 11. Kvarstående risker

1. Off-network-regeln kan smitta spelare på verkliga men omappade vägar eller bakom hinder (avsnitt 6). Konstanterna (`offnetwork.ts`) är gissningar att justera efter fälttest.
2. Cykelsimuleringen använder en bot och ett gitter; verklig vägnät-AI med exponering är inte simulerad (motorn testad i enhetstester).
3. Gångläget har kvar sin off-trail-lucka (spelare utanför stigarna är osmittbara). Den hör till en senare gång-mesh.
4. Utan tile-data om hinder kan inga zombie-only-länkar eller off-trail-rörelser införas säkert.
5. Mätningarna är tile-viktade och inte befolkningsviktade; andelen misslyckade starter i verkligheten är okänd.
6. Telefonprov saknas helt.

## 12. Rekommendation: villkorat GO för merge, NO-GO för produktion

- **GO för merge** (efter granskning): komponentvalet är oförändrat (bevisat identiskt på 160 + 108 körningar), bara cykelläget får ny regel, allt automatiskt är grönt och ändringarna är små och avgränsade. Jag har inte mergat och inte driftsatt.
- **NO-GO för produktion** tills off-network-regeln och cykelmeddelandet provats på en telefon på riktiga cykelturer (både på mappade och omappade vägar) och konstanterna bekräftats.
- **Starkaste motargumentet:** regeln är en gissning om hur ofta cyklister är "utanför" i verkligheten; ett fel där kostar förtroende (en spelare smittas utan att någon zombie kunde nå dem). Den som vill vara försiktig kan sätta `offNetworkExposure: false` (en rad i `game-rules.ts`): då återgår cykelläget till v2.2:s beteende utan att något annat ändras.
