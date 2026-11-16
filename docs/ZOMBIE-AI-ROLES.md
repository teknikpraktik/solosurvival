# Zombie-AI med roller: förföljare och genskjutare

Första versionen av en varierad jakt. Inspirerat av Pac-Man: två fiendetyper med olika målpunkter, där enkla regler ska ge en jakt
som upplevs smart men som går att läsa och lura. Flankerare ingår inte (se avsnitt 7).

- Kod: `src/engine/ai/roles.ts` (beslut), `src/config/zombie-ai.ts` (alla balansvärden), `src/engine/ai/zombie-ai.ts` (inkoppling),
  `src/engine/pathfinding/astar.ts` (`travelTimes`, en tidsbegränsad restidssökning).
- Påslag: `Rules.zombieAi = "roles"`. Vuxenappen slår på det för nya Free Play-matcher (`zombieAi: "roles"` i
  `src/app/_client/SessionProvider.tsx`). Ta bort raden för att gå tillbaka. Ingen inställning för spelaren.
- Tester: `src/tests/simulation/roles.test.ts`, `src/tests/unit/zombie-ai-session.test.ts`.
- Jämförelse gammal/ny AI: `npx tsx scripts/ai-compare.ts` (se avsnitt 6).

## 1. Vad undersökningen visade om den tidigare AI:n

Antagandena i uppdraget stämde inte helt. Skillnaderna styrde lösningen.

| Antagande | Verklighet i koden |
|---|---|
| Zombierna jagar spelarens senast kända position från positionsavslöjanden | **Magnetjakt** (`rules.magnetic`, alltid på): med giltig GPS får varje zombie inom `magnetRangeM` spelarens nätsnappade position ungefär varje sekund. Till fots är räckvidden obegränsad, på cykel 2 km. Avslöjanden var 60–180 s och upptäcktsradien finns kvar men spelar nästan ingen roll så länge GPS fungerar. |
| Det finns genskjutning | Två modeller finns. Free Play har den ursprungliga: riktningen läses mellan två observationer med 1 s mellanrum som måste skilja 8 m. Det inträffar nästan aldrig, och på grafer med terrängkanter är modellen avstängd helt. I jämförelsen gjorde den 0,0–0,8 försök per match, alltså var Free Play i praktiken ren förföljelse. Kampanjen har en nyare "track"-modell (`interceptModel: "track"`), som är orörd. |
| Zombier rör sig utanför vägnätet | Stämmer. I livespelet läggs ett terränggitter (8 grannar, 45–120 m) över spelområdet utan byggnader och vatten, och zombierna går där i halv fart (`OFF_TRAIL_FACTOR`). All vägplanering (A* och det delade kortaste-tid-trädet) räknar tid som längd/fart per kant. Genvägar väljs alltså redan bara när de är snabbare. Det återanvänds oförändrat. |
| Cykel och till fots skiljer sig | Samma AI. Cykel: snabbare spelare (4,5 m/s nominellt) än zombierna (Survival Normal ≈ 3,8 m/s), magnet bara inom 2 km, och 70 % av nya zombier placeras framför en rörlig spelare. Till fots är zombierna i Survival snabbare än en gående spelare (6,7 mot 4,7 km/h). |
| Mini Outbreak | Samma motor via `ProductProfile`. Mini skickar ingen `zombieAi` och behåller exakt sitt beteende (testat). |
| Sparade matcher | Hela `GameState` sparas i IndexedDB och reglerna räknas om från `MatchParams` vid återupptagning. Matcher från en annan `RULES_VERSION` avbryts. |

Övrigt som påverkade designen:

- Det finns redan ett sökbeteende: `investigate` går till senast kända position och övergår sedan till `patrol` (högst 90 s).
- Staplade jagande zombier långt från spelaren tas bort (`culling.ts`), vilket redan bryter upp långa "tåg".
- Prestanda: förföljarnas omplanering (var 2–4 s i kontakt) dominerar helt, med 250–400 sökningar per minut på stignät. På terränggitter delas ett kortaste-tid-träd per mål, vilket ger cirka 7–9 sökningar per minut men tunga sådana.

## 2. Informationsmodellen

Koden skiljer på tre positioner:

| | Var | Vem får läsa |
|---|---|---|
| **Verklig** position | `StepInput.position` / `PlayerState.position` | Bara befintliga närhetsregler: magnetens räckvidd, upptäcktsradien, spurtradien, infektion och spawn. Aldrig rollernas beslut. |
| **Observerad** position | `PlayerState.track`: snappade observationer med `observedAtS`, högst 8 stycken, cirka var 4:e sekund (magnet), plus varje positionsavslöjande | Förföljare (senaste observationen) och genskjutare (historiken) |
| **Uppskattad framtida** position | `Motion` (riktning och fart vid senaste observationen) och `Candidate` (punkt, förväntad tid, sannolikhet) i `roles.ts` | Genskjutaren |

`interceptorStep` får bara `track`, grafen och zombiernas egna lägen. Testet "the same reveals give the same decisions…" kör två
matcher där spelaren rör sig olika mellan avslöjandena (rakt fram respektive sväng) och kräver identiska zombietillstånd i varje
steg fram till nästa avslöjande. Med magnetjakten påslagen är "mellan avslöjandena" i praktiken en sekund. Informationsgränsen
skyddar alltså mot fusk i koden, medan det spelbara sättet att lura en genskjutare är trögheten i avsnitt 4.

## 3. Rollerna

**Förföljare (cirka 70 %).** Exakt den tidigare jakten utan genskjutning: snabbaste vägen i tid mot den senaste observationen,
terränggenvägar inräknade, med det befintliga sökbeteendet när kontakten tappas. Ett test kräver att en förföljare rör sig
identiskt med en gammal zombie som inte får genskjuta.

**Genskjutare (cirka 30 %).** Förföljer tills den kan läsa spelarens rörelse, sedan:

1. **Rörelse.** Senaste observationen jämförs med den yngsta som är minst 6 s äldre och 20 m bort (kort fönster, högst 40 s).
   Riktning och fart kommer från den. För lite, för gammal (över 12 s) eller för liten rörelse ger ingen prognos, vilket täcker
   stillastående spelare och GPS-brus. Pekar det korta och det långa fönstret åt motsatta håll och den nya rörelsen är under 24 m
   räknas historiken som motsägelsefull. Fart under 35 % av nominellt tempo räknas som stillastående.
2. **Prognos på stig.** Från spelarens kant och riktning, framåt utan vändning och bara längs riktiga stigar, högst 240 s med
   uppskattad fart (högst 900 m). I varje korsning delas sannolikheten efter hur rakt varje gren fortsätter: rakt fram väger 1,35,
   vinkelrätt eller skarpare väger 0,35. Grenar under 25 % följs inte. Kandidatpunkter läggs med fasta mellanrum längs kanterna
   (20 s spelartempo, 25–90 m) och på noderna. Zombien vet aldrig vilken gren spelaren tar, bara hur sannolik den är.
3. **Prognos utanför stig.** Ligger spelaren på en terrängkant eller mer än 35 m från stigen: rak linje, punkter 30–120 s fram.
   Punkten måste ha nät inom 80 m (alltså inte i vatten eller i en byggnad) och ligga inom cirka 45° av färdriktningen.
   Sannolikheten halveras var 90:e sekund.
4. **Val.** En begränsad restidssökning från zombien (`travelTimes`, samma kostnadsmodell som all annan planering, så terrängen
   räknas med halv fart och vatten och byggnader saknar kanter) ger zombiens tid till varje kandidat. En punkt duger om zombien är
   framme 4–60 s före spelaren och spelaren är minst 10 s bort. Poängen är sannolikheten × (1 − 0,5 × spelarens tid/240 s), alltså
   föredras tidiga och sannolika möten. En punkt som en annan genskjutare redan går mot (inom 45 m) får halva poängen. Sedan en
   A*-sökning till vald punkt.
5. **Vid punkten.** Zombien väntar där. Kommer spelaren inom 50 m (enligt senaste observationen) går den rakt på spelaren som en
   förföljare.
6. **Reserv.** Hittas ingen punkt fortsätter den förfölja och försöker igen om 20–30 s. Rollen ändras aldrig.

## 4. Tröghet och omplanering

- En plan hålls i 15–25 s innan genskjutaren tittar på historiken igen, oavsett vad spelaren gör under tiden. Det är fönstret där en
  spelare som byter väg lurar den: zombien fortsätter mot den gamla punkten (testat i "right after the turn…").
- Vid omprövning behålls planen så länge punkten finns kvar i den nya prognosen och fortfarande går att nå i tid. En ny punkt
  ersätter den bara om den ger minst 1,3 gånger högre poäng.
- Planen avslutas utan ny information när den beräknade mötestiden passerat med 8 s (spelaren kom inte).
- Kontaktförlust avslutar inte en plan (i den gamla modellen gjorde den det efter 10 s). Planen har en egen slutpunkt.
- I testet med tre genskjutare intill varandra väljer de minst två olika punkter och byter punkt högst två gånger på tre minuter.

## 5. Startparametrar och motiv

Alla värden finns i `src/config/zombie-ai.ts`.

| Parameter | Värde | Motiv |
|---|---|---|
| `interceptorShare` | 0,3 | Enligt uppdraget. Delas ut efter spawnordning: zombie nr 3, 6, 10, 13, 16, 20 … blir genskjutare, alltså ingen av 2, en av 3–5, två av 6–9 och sex av 20. Det kräver ingen slump och ger aldrig enbart genskjutare. Gäller alla svårighetsgrader. Easy hade tidigare `interceptShare` 0, men den gamla genskjutningen utlöstes ändå aldrig. Detta är ett beslut att pröva i fält. |
| `headingMinMoveM` / `headingMinAgeS` | 20 m / 6 s | 5–10 m GPS-brus i båda ändar ger upp till cirka 20 m skenbar rörelse. En gående spelare passerar gränsen på cirka 15 s, en cyklist på under 5 s. |
| `maxInfoAgeS` | 12 s | Tre missade magnetprov (prov var 4:e sekund). |
| `horizonS` / `horizonMaxM` | 240 s / 900 m | Fyra minuter fram ger cirka 310 m till fots och 900 m på cykel. Det är en närtidsfångst och ingen bevakning av mål eller extraction. |
| `straightBias` / `minProbability` | 0,35 / 0,25 | I en fyrvägskorsning går 66 % rakt fram. Prognosen når två korsningar framåt i ett rutnät och mycket längre längs en ensam stig. |
| `marginS` / `maxWaitS` | 4 s / 60 s | Zombien ska vara där först men inte stå i minuter. |
| `attemptS` / `holdS` | 20–30 s / 15–25 s | Samma takt som den gamla taktiska omplaneringen. Ger spelaren ett tydligt fönster att byta väg. |
| `switchGain` | 1,3 | Små förändringar ska inte ge vändningar. |
| `closeChaseM` | 50 m | Ungefär upptäcktsradien till fots. Därifrån är det rak jakt och spurt (100 m) som gäller. |

Hastigheter, terrängstraff, spawn, antal, fångst och avslöjanden är oförändrade.

## 6. Tester och jämförelse

**Enhets- och simuleringstester** (`roles.test.ts`, 24 tester, och `zombie-ai-session.test.ts`, 2 tester) täcker uppdragets åtta
scenarier: rak väg, slingrande stig med terränggenväg som lönar sig, kortare men långsammare genväg som inte väljs, vägbyte efter
avslöjande där zombien går mot fel mål, stillastående spelare/GPS-brus/för kort historik, vatten utan passage (även utanför stig),
flera genskjutare med stabila val, sparande och återupptagning (JSON-rundtur ger identisk fortsättning, äldre zombier utan roll, en
återställd match behåller sin AI). Dessutom täcks informationsgränsen, att förföljare är oförändrade, att vuxenappens växel bara
gäller Free Play och att en Mini-liknande profil behåller sin gamla AI. Den gamla AI:ns deterministiska fingeravtryck
(`scripts/regression-fingerprint.ts`) är oförändrat och alla 646 tester i huvudappen samt 26 i Mini Outbreak passerar.

**Jämförelse** (`scripts/ai-compare.ts`): Survival med samma frön (100…) och samma scenarier för båda AI:erna. Spelartyper:
`risk` (ser zombier inom 1 km och väjer), `random` (slumpar i korsningar) och `straight` (förutsägbar, håller kursen). Spelaren
håller sig alltid på stig. Nät: idealiskt rutnät, Karlstad (tätort) och skog (stigar), samt skog och Karlstad med terränggitter
(som i livespelet men utan byggnader och vatten). Spelaren jogger (1,5 × gångtempo) i Normal, eftersom zombierna annars springer
ifrån en gående spelare, och går i Easy.

Alla tabeller finns i [`docs/ZOMBIE-AI-ROLES-RESULTAT.md`](ZOMBIE-AI-ROLES-RESULTAT.md) (12–16 matcher per cell, 95 %
Wilson-intervall). Kolumnen "planer" räknar genskjutningsplaner per match. En plan slutar på ett av fyra sätt: **möte** (spelaren kom
till punkten och zombien var där), **kontakt** (zombien var inom 60 m från spelaren när planen slutade), **passerad** (spelaren kom
men zombien var inte framme) eller **missad** (spelaren kom aldrig).

**Vad simuleringarna visar**

| Fråga | Resultat |
|---|---|
| Genskjuter den gamla AI:n? | Nästan aldrig: 0,0–1,0 planer per match på stignät och exakt 0 på terrängnät. Free Play var i praktiken ren förföljelse. |
| Når genskjutarna relevanta mötespunkter? | Ja, ibland. Planerna är 0,2–4,6 per match. Mot spelaren som går rakt fram slutar 26–100 % av planerna i möte eller kontakt (oftast kontakt, cirka 50 %). Mot den slumpvis gående spelaren 5–75 %, beroende på nät. |
| Kan riktningsbyten lura dem? | Ja. Mot riskboten, som ser zombierna inom 1 km och väjer, missas 72–100 % av planerna. Mot den slumpvis gående spelaren, som svänger i två av tre korsningar, släpps de flesta planer vid omprövningen. En spelare som håller kursen blir oftare mött. |
| Sprids rutterna, eller bildas fortfarande tåg? | Oförändrat. Andelen jagande zombier bakom spelaren och spridningen i deras riktningar skiljer sig med högst cirka ±5 procentenheter och ±0,07, utom på rutnät med cykel och rakt gående spelare (24 % → 3 % bakom). Förföljarna är 70 % och fångar fortfarande de flesta. Flankerare kan behövas om tåg syns i fält. |
| Ger terränggenvägar oproportionerligt svåra lägen? | Inget tecken på att genskjutarna förvärrar det. Andelen fångster där fångande zombie gått i terräng den sista minuten är ungefär densamma för båda AI:erna (Karlstad med terräng och riskboten till fots: 58 % → 73 %, men med n = 11–12). Däremot är den hög för **båda** på cykel i Karlstad med terräng (82–100 %). Det är en befintlig egenskap hos terrängnätet som bör kontrolleras i fält. |
| Fångstfrekvens och tid till fångst | Ingen systematisk skillnad. I Normal fångas nästan alla simulerade spelare oavsett AI. Där det skiljer sig överlappar intervallen: Karlstad med terräng och rakt gående spelare 42 % → 75 % till fots och 42 % → 33 % på cykel, skog med terräng i Easy 75 % → 50 %. Mediantiden till fångst rör sig åt båda hållen (till exempel 27 → 22 min för cykel i skog och 12,5 → 23 min för riskboten i Karlstad med terräng). |
| Vägberäkningar och prestanda | Stignät: sökningar per minut lika eller lägre (250–400 → 250–390), avsökta noder ±10 %. Terrängnät: sökningar per minut ungefär fördubblade (6–10 → 11–17), eftersom varje beslut kostar en begränsad restidssökning och en A*, men avsökta noder är oförändrade (±5 %) eftersom förföljarnas delade träd dominerar. Tid per motorsteg är oförändrad (0,05–1,6 ms beroende på nät). |

**Vad som kräver fälttest:** om genskjutningarna *upplevs* som begripliga och smarta, om väntande zombier ser konstiga ut, och om
balansen med riktiga människor ändras. Simulerade spelare saknar både rädsla och kartläsning, och riskboten ser zombierna lika
väl som spelet visar dem.

## 7. Kvarvarande begränsningar

- **Flankerare behövs inte än.** Spridningen kommer från att genskjutare med olika lägen väljer olika punkter och från
  delningsavdraget. Ett separat flankbeteende bör bara läggas till om fältet visar tydliga tåg.
- Prognosen antar att spelaren fortsätter i samma fart och följer stigen. Den räknar inte med att spelaren vänder (vändningar fångas
  först vid nästa omprövning), och utanför stig är den en rak linje som inte vet om en sjö mellan spelaren och punkten.
- Jämförelsens terrängnät saknar byggnader och vatten eftersom karttilesen inte finns i repot. Hinderlogiken är testad separat på
  handbyggda nät och på befintliga fixturer.
- Simulerade spelare är inte människor. Siffrorna jämför AI:erna med varandra, inte med verklig svårighet.
- Kampanjen använder fortfarande sin balanserade "track"-modell. Om rollerna ska in där krävs ny balansering per uppdrag.

## 8. Att kontrollera i nästa fälttest

1. Upplevs några zombier komma *framifrån* på ett begripligt sätt, och går det att se att de "räknade ut" vart man var på väg?
2. Går det att lura en genskjutare genom att byta väg i en korsning när den kommer emot? Svaret bör vara ja inom cirka 15–25 s.
3. Står zombier och "väntar" i korsningar på ett sätt som ser konstigt ut? Väntan är högst 60 s per punkt.
4. Cykel: kommer genskjutarna ut på vägen framför i tid, eller är de för långsamma för att hinna, så att genskjutningen inte märks?
5. Terräng: skär zombier genom skog på ett sätt som känns orättvist? Det gäller särskilt i tätort, där riktiga byggnader och vatten
   finns i spelet men inte i simuleringen.
6. Fältloggen: antal `zombie_intercept`-händelser per match (förväntat 1–5) och om fångster kommer från genskjutare.
