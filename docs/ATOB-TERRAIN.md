# A TO B till fots i terräng

Gren: `feature/atob-terrain`, **staplad på PR #43** (`feature/bike-network-improvements`, för `RULES_VERSION` 2.3.0 och `networkPieces`). Bas för PR:en är därför den grenen; byt till `master` när #43 är mergad.

Etiketter: **[fakta]** läst i koden eller mätt/testat, **[sim]** simulering med botar (inte människor), **[antagande]**, **[telefon]** ej provat på en telefon. Ingen funktion är provad på en telefon.

## 1. Sammanfattning

A TO B till fots är nu **terrängläge**: A (din position) och B (valfri punkt på kartan) behöver inte ligga vid en stig eller väg, ingen väg läggs ut, och målet är **exakt den punkt du valde** (förut flyttades det till närmaste stig, och B längre än 150 m från en stig avvisades). Cykel är oförändrad och vägbunden. Mission och Survival till fots är oförändrade.

| | Före | Nu (A TO B till fots) |
|---|---|---|
| A och B | måste ligga ≤ 150 m från en stig i samma sammanhängande nät | var som helst, även utanför Värmland och i sjö/skog |
| Mål | snappat till stigen | exakt vald punkt |
| Zombier | bundna till stigarna | stigar i full fart + terrängnät längs A–B i absolut tempo: Lätt 2,5, Normal 3,5, Svår 4,5 km/h |
| Rutt | kortaste väg och två alternativ | ingen rutt; fågelvägen är en hjälplinje |
| Tidsgräns | ruttens längd | fågelvägen × 1,35 (som Mission) |

## 2. Hur det är byggt [fakta]

1. **Terrängnät** (`src/geo/graph/terrain-mesh.ts`): ett gitter längs A–B i en korridor (halv bredd 700 m, 500 m marginal bortom A och B), 8 grannar (rakt och diagonalt), avstånd 45–70 m anpassat så att högst 7 000 noder byggs. Kanterna är `offtrail`. Med 8 grannar ligger varje punkt i korridoren högst ca 0,2 × avståndet från en kant; testat: högst 20 m (infektionsradien) för 1, 6 och 20 km, så en spelare mitt i en gitterruta kan alltid nås.
2. **Stigar** från kartdata i korridoren behålls oförändrade (långa stigkanter delas i bitar om högst 120 m så att zombier kan gå på och av var som helst) och kopplas till gittret vid varje stignod som ligger inom 0,8 × avståndet från en gitternod. Allt blir en sammanhängande graf.
3. **Motorn.** Zombiens fart multipliceras med `Rules.offTrailFactor` (= off-trail-fart / zombiens stigfart, t.ex. 3,5 / 7 = 0,5 på Normal) när den står på en terrängkant; planeringen använder tid (längd / fart) så zombien väljer stigen när den är snabbare. Snappning använder ett rumsindex när grafen har terrängkanter, och en stig vinner över terräng om den ligger inom 4 m. Interception (genskjutning) är av i terrängnät (odefinierad i öppen terräng).
4. **Prestanda.** Alla jagande zombier planerar mot samma observerade punkt; en A*-sökning per zombie och omplanering var för dyr på ett nät med tusentals noder (**54–60 ms per 0,2 s-steg** för 20 km). Nu byggs ett delat kortaste-tid-träd per mål (runt 15 m-steg, fyra i cache), vilket gav **0,6–1,4 ms per steg** på utvecklingsdatorn.
5. **Prepare** (`prepare.ts`): grenen `prepareTerrainAtoB` hoppar över spärrarna `a_off`, `b_off`, `no_path` och `outside_region` för gång; avstånden "för nära/för långt" (300 m–20 km) gäller fortfarande.
6. **UI:** förhandsvisningen förklarar läget ("Walk any way you like to B … The game does not know about roads, railways, water or private land …"), kartan ritar aldrig terrängkanterna, och tidsuppskattningen använder fågelväg × 1,35.
7. **Sparad match:** terrängkanterna sparas med grafen (`serializeGraph`), så en återupptagen match fungerar.

Regelversionen är **2.4.0**: sparade matcher från 2.3.x återupptas inte.

## 3. Mätningar

**Byggtid och storlek [fakta, utvecklingsdator]**

| A→B | Noder / kanter | Avstånd | Prepare | ms per steg | JSON-storlek (sparas en gång) |
|---|---|---|---|---|---|
| 1,5 km, Karlstad centrum | 4 279 / 12 298 | 45 m | 0,5 s | 0,4–0,7 | ca 1–2 MB |
| 5 km, Karlstad | 7 228 / 23 016 | 45 m | 0,4–0,6 s | 0,6–1,2 | ca 3,6 MB |
| 3 km, skog | 3 019 / 11 341 | 45 m | 0,14–0,17 s | 0,2–0,3 | – |
| 3 km, utanför kartdata | 2 848 / 11 031 | 45 m | 0,03–0,04 s | 0,2 | – |
| 12 km, skog | 6 838 / 26 051 | 51 m | 0,1–0,3 s | 0,4–0,8 | – |
| 20 km, Karlstad | 9 278 / 30 844 | 65 m | 0,4–0,65 s | 0,6–1,4 | ca 5,4 MB |

En telefon är troligen flera gånger långsammare; hur stegen och sparningen beter sig där är **[telefon]** inte mätt.

**Balans [sim, 10 matcher per rad, tolka med stor försiktighet; intervallet är ±25 procentenheter]**. Hela raden: bot "follower" går fågelvägen utan hänsyn till zombier, bot "planner" väljer väg med marginal mot zombiernas ankomsttid. "Klarade" = nådde B inom tidsgränsen. Zombiernas antal följer sträckan (2,5 per km vid Normal).

| Område, sträcka | Lätt: follower / planner | Normal: follower / planner | Svår: follower / planner |
|---|---|---|---|
| Karlstad centrum 1,5 km (stigar) | 10 % / 90 % | 20 % / 0 % | 0 % / 0 % |
| Karlstad 5 km | 30 % / 80 % | 0 % / 0 % | 0 % / 0 % |
| Skog 3 km | 100 % / 100 % | 20 % / 100 % | 0 % / 0 % (planner lever efter 10 min i 100 %: tidsgränsen) |
| Skog 12 km | 0 % / 100 % | 0 % / 60 % | 0 % / 0 % (planner lever efter 10 min i 80 %) |
| Utanför kartdata 3 km (bara terräng) | 10 % / 100 % | 10 % / 100 % | 0 % / 0 % (planner lever efter 10 min i 100 %) |
| Karlstad 20 km | 0 % / – | 0 % / 0 % | 0 % / 0 % |

Läsning [sim]:
- **Öppen terräng utan stigar är lätt för en spelare som undviker zombier** (Lätt och Normal 100 % för "planner"): en gående spelare (4,7 km/h) är snabbare än zombier på 3,5 km/h, och i öppet landskap finns alltid en väg att gå runt. Det är samma mönster som i den tidigare utredningen.
- **Där stigar finns är det svårt** (Karlstad 0–20 % på Normal): zombierna springer på stigarna i full fart. Det är avsett (hotet ligger på stigarna) men Svår är i praktiken ospelbar överallt, precis som tidigare.
- **Planner får tidsgränsfel på Svår:** den lever efter 10 minuter men hinner inte fram, eftersom tidsgränsen är fågelväg × 1,35 med liten marginal på Svår. Det är ett balansvärde (`MARGIN`), inte ändrat nu.
- Intervallen är stora (n = 10). Ingen avvägning mot ett vinstmål har gjorts; värdena Lätt 2,5 / Normal 3,5 / Svår 4,5 km/h är preliminära och oförändrade.

**Regression [fakta]:** 108 simulerade matcher (gång/cykel × 3 svårigheter × 3 lägen × 6 seeds) och 160 `prepareMatch`-anrop på riktiga tiles (Survival och Mission, gång och cykel) är **identiska** med `master`. 361 tester gröna (348 före etappen), `tsc` och lint rena, produktionsbygge lyckas, e2e `atob` 8/8, `play` 16/16, `background` 6/6, `capture` 5/5.

## 4. Begränsningar och risker

1. **Terrängnätet vet inget om vatten, vägar, järnvägar eller byggnader.** Zombier går över dem (och kan stå i en sjö). Spelaren väljer själv sin väg; spelet föreslår aldrig en. Texten i förhandsvisningen varnar, men den som väljer ett B på andra sidan en motorväg får ingen varning. Ett billigt skydd som inte är infört: fråga kartan (som redan visar vatten, byggnader och vägar) vad som ligger under den tryckta punkten och avvisa B om det är vatten eller byggnad. **Inte prövat.**
2. **Zombierna kan gå över större vägar** via gittret; v2.2:s regel att zombier inte korsar större vägar utan kartlagd passage gäller bara stignätet, inte terrängnätet.
3. **Balansen är inte avstämd** (stor skillnad mellan stig och terräng; Svår ospelbar). Det är ett produktbeslut.
4. **Stora grafer:** 5,4 MB sparas i IndexedDB vid matchstart (en gång). Prestanda och minne på äldre telefoner är **[telefon]** inte mätt.
5. **Genskjutning är av** i terrängläget, så zombierna är något mindre listiga än i stignätet.
6. **Sparade matcher** från före 2.4.0 återupptas inte.
7. **Spelare utanför gittret** (mer än ca 20 m från en kant) kan inte uppstå i korridoren, men en spelare som rör sig mer än 700 m från linjen A–B lämnar nätet. Då snappas spelaren till närmaste kant och zombierna väntar vid den, som för cykel före 2.3 (ingen exponeringsregel för gång).

## 5. Rekommendation

**Villkorat GO för merge** (efter #43), **NO-GO för produktion**: terrängläget är automatiskt verifierat, och spelmekaniken är oförändrad där inget ändrats (fingeravtryck). Telefonprov av prestanda och upplevelse saknas, B-validering mot vatten/byggnad saknas, och balansen är inte avstämd (särskilt Svår).

Förslag på nästa steg, i ordning: (1) validera B mot kartans vatten/byggnader/vägar; (2) mät mesh-sparning och steg på en telefon; (3) balanssvep per svårighet med fler matcher och en bättre "människoliknande" bot; (4) därefter Mission och Survival i terräng, som kräver att checkpoints och extraction placeras på säker mark.
