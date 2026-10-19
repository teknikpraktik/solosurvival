# Fälttest 1 – rättningar och förbättringar

Status: implementerat och testat med simulerad/mockad GPS och automatiska tester. **Ännu inte verifierat med telefonens riktiga GPS.**

## 1. Zombierna syntes aldrig – grundorsak
Spelmotorn skapade zombier korrekt (mätt med riktiga Värmlandstiles, alla svårigheter): initialt 2/3/4 zombier (Walk Lätt/Normal/Svår), 4/5/7 (MTB), fler tillkommer successivt (upp till 6/9/12 Walk). Spawn kräver ≥ 250 m (Walk/Run) respektive 400 m (MTB) avstånd och väljs längdviktat över hela nätet, så i simuleringarna låg närmaste zombie 350–1 100 m bort vid start och närmade sig långsamt (patrull 0,6–0,8 m/s, försprång 3–4 min utan rörelse).

**Orsak:** UI:t (inte motorn) filtrerade bort allt utom zombier inom *150 m* (Walk; 250 Run, 400 MTB), `AWARENESS_M` i `src/play/config.ts`, och visade då "Inga zombier nära". Radien var mindre än spawnavståndet, så under en normal match syntes ingen zombie förrän den redan var nästan framme (Lätt: aldrig; i simuleringen var närmaste zombie 850–2 100 m under hela passet). Meddelandet gav dessutom intryck av att inga zombier fanns. Spawnfel, routingfel och serverfel (det finns ingen server; motorn körs lokalt) kunde uteslutas: antal, positioner och tillväxt var korrekta, inga `spawn_skipped` på riktig data.

**Åtgärd (ingen balansändring, ingen teleport/placering på spelaren, spawnreglerna oförändrade):**
- Synlig/varnande närhetsradie = 500 m i små spelområden, 1 000 m i stora (`proximityRadiusM`, utgår från samma radie som kartdata hämtas med: datahämtningsradie ≥ 3,5 km ⇒ stort; i praktiken MTB och långa pass). Geografiskt avstånd, inte zoom/pixlar.
- HUD visar alltid avstånd till närmaste zombie ("Zombie 1,1 km") eller "Inga zombier ännu" om inga finns, i stället för det missvisande meddelandet.
- Instrumentering i testloggen (`/field`): `match_start` (antal initiala zombier, regler, närhetsradie), `zombie_spawned`, `spawn_skipped`, `zombie_sample` var 30 s (antal, närmaste avstånd, antal inom radien), `zombie_near_sound`. Skiljer spawnfel (`spawn_skipped`, antal 0) från routing (zombier finns men närmar sig inte) och rendering (antal inom radien > 0 men inga markörer; `render_problem`).
- Felsökningshak: `localStorage["outbreak.debug"]="on"` exponerar sessionen som `window.__outbreak` (används av e2e).
- Känd spelbalansfråga (ej ändrad): på Lätt ligger zombierna ofta långt bort hela passet (långsamma, få, svag reveal-respons). Utvärdera i fält innan balans ändras.
- Utanför det ursprungliga nätet (radie 0,5 × sträcka + 0,5 km): motorn fortsätter, zombier finns kvar (testat); inget nytt kartdata hämtas, så spelaren ses som utanför nätet.

## 2. Riktningspil och Track Up
- `src/play/heading.ts` (ren presentationslogik): GPS-kurs används ≥ 1 m/s, annars kurs från förflyttning ≥ 12 m (≥ 1,5 × noggrannheten). Under 0,5 m/s, dålig noggrannhet (> 25 m) och bortfall ändras ingenting (senaste riktning behålls). Ny riktning kräver två sammanhängande mätningar, dödband 4°, utjämning. Ingen kompass/sensor och inga nya behörigheter: färdriktning räcker (iOS/Android ger `heading` när man rör sig).
- Pilen (SVG, vit kant + mörk ytterkant) är en DOM-markör roterad med CSS-transform; utan riktning visas en neutral prick.
- Track Up är standard i matchen: `easeTo`/`jumpTo` i MapLibre med bearing och padding så att spelaren ligger i nedre delen (30 % framförhållning). Rotation sker bara vid riktningsändring ≥ 5°, kortaste vägen, 0,8 s; vanlig förflyttning flyttar kameran med `jumpTo` (en rendering per GPS-fix). Ingen automatisk zoom. Kompassknappen växlar Track Up/North Up; ⌖ centrerar igen. Påverkar aldrig position eller motor.

## 3. Mjuk zombieanimation
Motorn är auktoritativ (ingen server finns; samma klient). `src/play/zombie-anim.ts` animerar den visuella positionen mot motorns kant+sträcka längs kantens polylinje, över noder mellan intilliggande kanter, med hastighet ≤ ~6 × zombiens fart; omplacering > 30 m (spawn/återställning) snappas. Allt i en enda `requestAnimationFrame`-loop i `GameMap` som vilar när sidan är dold eller matchen pausad. Inga extra dataflöden: samma tillståndsuppdateringar (≈2 Hz) som tidigare. Animationen läses aldrig tillbaka till motorn.

## 4. Zombiesymboler
Lokala SVG-ansikten (`src/app/_client/symbols.ts`): mörk skiva med ljus ring, grönaktigt ansikte med urholkade glödande ögon, tänder och spricka; jagande zombier får röd ring och röda ögon. DOM-markör 34 CSS-px (samma storlek oavsett upplösning), inga bildförfrågningar.

## 5. Närhetsljud
Radie enligt avsnitt 1. Ett ljud när en zombie för första gången är inom radien (en gång per zombie och match, även om den lämnar och återkommer), kontroll högst 1 gång/s, cooldown 12 s med gruppering (nya zombier under cooldown ger ett gemensamt ljud efteråt). Efter återställd match ger redan kända zombier inget ljud. Lokal fil `public/audio/zombie-near.wav` (40 KB, genereras av `scripts/make-audio.mjs`) avkodas med WebAudio efter första knapptryckningen (START), cachas av service workern; syntetiskt reserv-ljud om filen saknas. WebAudio följer telefonens ljudinställningar (på iPhone tystas det av ring-/tyst-omkopplaren). Av/på: högtalarknappen i spelet och kryssrutan i NEW GAME.

## 6. Dialoger
- Ny gemensam `Modal` (`src/app/_client/Modal.tsx`): helskärmsbakgrund, safe areas, `100dvh`, scrollbart innehåll, **knapparna ligger alltid synliga i dialogens fot**, X (≥ 48 px) uppe till höger när dialogen får stängas.
- Rättat: pausdialogen låg bredvid/över STARTA/FORTSÄTT i kontrollfältet (flyttad: dialogen har egna knappar; X stänger den och visar kontrollfältet). Uppdateringsraden täckte spelkontrollerna (visas inte längre under match). Kontrollfältet klipptes på 320 px.
- Sidor (HOW TO PLAY, PREVIOUS GAMES, NEW GAME, testläge) har ✕ uppe till höger.
- **Utan X (obligatoriska beslut):** *Match slut* (resultat) – spelaren väljer TILL START eller PREVIOUS GAMES. Med X: Redo/Pausad, GPS saknas, Avsluta matchen? (X = fortsätt spela).
- PWA-läge: `viewport-fit=cover` + safe-area-insets används; inte testat i installerad PWA på enhet.

## Kvarstående
Verklig GPS/heading på iPhone och Android; ljudnivå och ringkontakt/tyst-läge; läsbarhet i solljus; zombie-balans på Lätt; PWA-läge.

## Uppföljning efter fälttestet (zombie 600 m syntes i HUD men ritades inte)
HUD:en visade närmaste zombie oavsett avstånd, men kartan ritade bara zombier inom närhetsradien (500 m i små områden). Nu ritas och räknas zombier inom `VISIBLE_RADIUS_M` = 1 000 m (alla områden); längre bort visar HUD:en "Inga zombier inom 1 km". Varningsljudets radie (500/1 000 m) är oförändrad.

## Fälttest 2: mer action (zombier, magnet-jakt, närmare spawn)
Önskemål efter spel i Normal: fler zombier, jakt "som magneter", zombier nära redan vid start (max 1 km). Avsiktliga balansändringar (alla värden i `src/config/activities.ts` och `game-rules.ts`):
- **Fler zombier (Normal):** Walk 6 start / 18 max (tidigare 3/9), Run 8/24 (4/12), MTB 10/30 (5/15). Lätt ×0,7, Svår ×1,3 som tidigare.
- **Spawn nära:** nya zombier hamnar 200–1 000 m från spelaren (Run 250–1 000, MTB 400–1 000; fågelvägen, och högst 1,5 × längs nätet). Om inget säkert ställe finns i bandet släpps övre gränsen (`spawn_relaxed` i loggen) i stället för att inga zombier tillkommer.
- **Magnet-jakt (`rules.magnetic`):** med giltig GPS känner varje zombie spelarens snappade position (en delad observation per sekund) och jagar kontinuerligt längs nätet, utan upptäcktsradie. Zombie-AI:n är i övrigt oförändrad: stigbunden, kortaste väg, genskjutning, ingen kunskap om mål eller extraction. Ogiltig/ingen GPS ⇒ ingen magnet (som tidigare). Replaneringar sprids 2–4 s.
- **Snabbare och tidigare:** zombiefart Walk 3,5 km/h (2,5), Run 6,5 (5), MTB 11 (9); försprång 60 s Walk/Run och 90 s MTB (180/240). Spelaren går fortfarande fortare än en zombie (Svår Walk ≈ 4,2 km/h), men kan fångas framifrån, av genskjutare och vid stopp.
- Ett gemensamt larm "Zombier jagar dig" (högst var 15:e s) i stället för ett per zombie.
- **Vägar:** zombier går på alla vägar och stigar som finns i spelets nät (stigar, spår, service-, bostads- och landsvägar utan genomfart). Större vägar (≤ tertiary) och järnväg är medvetet utanför nätet av säkerhetsskäl (spelaren ska aldrig ledas dit). Zombier på större vägar kräver kanter märkta "bara zombier" i grafen – kan göras separat.
- Mätt: motorsteg 0,05 ms med 26 zombier. Simulerade vinstandelar (naiv extraction-bot, rutnät, 20 frön) är i stort sett oförändrade jämfört med före (Walk Normal 15/20, Run Lätt 16/20, Run Normal 8/20).

## Fälttest 3: inget försprång, snabbare zombier
- **Försprång borttaget** (`headStartS` = 0 i alla aktiviteter): zombierna går och jagar från första sekunden. Motorn stödjer fortfarande ett valfritt försprång via reglerna.
- **Inte vid startpunkten:** minsta spawnavstånd 300 m för Walk/Run (tidigare 200/250) och 400 m för MTB, högsta 1 000 m.
- **Fart (Normal):** Walk 4,5 km/h, Run 7,5 km/h, MTB 12 km/h (tidigare 3,5/6,5/11). Lätt ×0,8, Svår ×1,2 (Walk Svår ≈ 5,4 km/h, fortare än en lugn gångfart: man får smita undan via annan väg).

## Fälttest 4: A TO B (ESCAPE bytt namn, egen A och B)
- Läget heter nu **A TO B** (internt fortfarande `escape`, så sparade matcher och tester fungerar). Ingen sträcka ställs in; sträckreglaget finns bara i MISSION (Survival har matchlängd).
- I NEW GAME väljer du A och B genom att trycka på en liten karta ("Välj A"/"Välj B"). A är din position om du inte väljer något annat (länk "Använd min position som A"). B måste väljas innan VISA RUTT går att trycka.
- Rutten (`src/routes/atob.ts`) är kortaste vägen längs stigar/vägar från A till B plus upp till två tydligt olika alternativ (≤ 1,6 × kortaste, olika kanter). B (och A) måste ligga ≤ 150 m från en stig i samma sammanhängande nät; annars avslås valet med förklaring (för nära < 300 m, för långt > 70 % av aktivitetens maxsträcka fågelvägen: Walk 4 km, Run 8 km, MTB 21 km, B utanför Värmland, ingen väg mellan punkterna).
- Kartdata hämtas runt mittpunkten mellan A och B (radie 0,75 × avståndet + 600 m) så att båda täcks.
- Är A vald långt från din position kan du se rutten men inte starta: "Du är N m från A. Gå till A för att starta" (inom 60 m från A), med länk "Sätt A till min position".
- Tidsgräns, mål (en destination B), zombier, magnet-jakt och övrig motor är oförändrade.

## Fälttest 5: avståndsetiketter och +20 % zombiefart
- Avstånd skrivs vid de **tre zombier som är närmast spelaren** (uppdateras varje bildruta), placerade åt spelarens håll relativt skärmen (40 px från markören, följer kartrotationen). HUD-rutan "Zombie N m" är borttagen. Etikett: hela meter under 100 m, annars närmaste 5 m, ≥ 1 km som "1,2 km".
- Zombiefart +20 % (Normal): Walk 5,4 km/h, Run 9 km/h, MTB 14,4 km/h (Lätt ×0,8, Svår ×1,2: Walk Svår ≈ 6,5 km/h).

## Fälttest 6: zombie-spurt
En jagande zombie (chase/intercept) som kommer inom **100 m** (fågelvägen) börjar **spurta**: dubbel fart (×2) i **20 s**, därefter **30 s återhämtning** (ingen ny spurt) innan den kan spurta igen. Konstanter i `game-rules.ts` (`SPRINT_*`), tillståndet (`sprintUntilS`, `sprintReadyAtS`) ligger i `Zombie` och sparas/återställs med matchen. Händelsen `zombie_sprint` loggas; varningen "Zombie spurtar!" spelas som kraftig signal högst var 8:e sekund. På kartan får spurtande zombier snabbare, tjockare puls och rödare etikett; animationen följer den dubbla farten längs stigen.

## Fälttest 7: On foot / Bike, engelska, skräm, fler checkpoints
- **Aktiviteter:** promenad borttagen. UI-valen är **On foot** (intern aktivitet `walk`, spelarfart 1,3 m/s) och **Bike** (`mtb`). `run` finns kvar internt men visas inte. Äldre sparade matcher visas som On foot/Bike.
- **Allt UI på engelska** (sidor, dialoger, meddelanden, ruttvarningar, GPS-fel, historik, testläge, HOW TO PLAY, manifest, `lang="en"`). Utvecklarsimulatorn `/dev` och dokumentationen är oförändrade.
- **Zombiefart:** On foot 6,75 km/h (+25 %), Bike 15,8 km/h (+10 %; cyklistens vanliga fart ≈ 16 km/h). Lätt ×0,8, Svår ×1,2. **Spurt 30 s** (var 20), x2 fart, 30 s återhämtning.
- **Mission:** ett checkpoint per ca 500 m till fots, 1 km på cykel (`src/routes/densify.ts`), jämnt längs slingan i körordning, hem sist. Spawn-exklusionszonen runt checkpoints krymper till 80 m när det finns fler än 6 mål.
- **A TO B:** valfri väg gäller. Kartan visar bara en svag streckad **fågelvägslinje** A–B (inte den kortaste vägen, inga ruttförslag). Den beräknade kortaste vägen används bara för att kontrollera att B går att nå och för tidsgränsen.
- **Zombievarningar** ("Zombie approaching", "Zombies are hunting you" …) visas mitt på skärmen med centrerad text och blinkande röd bakgrund (av vid "reduce motion").
- **Fångad:** helskärmsbild (`public/img/captured.svg`) med skakning och blixtar i 2,8 s, skrik-ljud (`public/audio/captured-scream.wav`, genereras av `scripts/make-audio.mjs`, följer ljudknappen) och vibration, därefter resultatdialogen (utan X). Ljudfilen förladdas vid START.
- **Startsidan** har en mörk skräm-bakgrund (`public/img/hero.svg`).
- **GPS-info visas inte** för spelaren (ingen GPS-pill, inga noggrannhetssiffror): bara korta meddelanden när något kräver åtgärd (söker position, nekad åtkomst, signal förlorad). Detaljerad GPS finns kvar under Test mode.

## Fälttest 8: zombier mellan A och B
I A TO B spawnar alla zombier (initiala och nya) **mellan A och B**: punktens projektion på linjen A→B ska ligga mellan 5 % och 97 % av sträckan (och framför spelaren när hen rört sig) och högst 30 % av avståndet (minst 250 m) åt sidan. Inget bakom A eller bortom B. Minsta avstånd till spelaren (300 m) gäller som förut; den vanliga 1 km-gränsen används inte i detta läge. Finns ingen plats i korridoren faller spawn tillbaka på vanliga reglerna (`spawn_relaxed` i loggen). Startpositionen sparas i matchtillståndet (`startPos`). Magnet-jakt och spurt är oförändrade, så zombierna lämnar korridoren när de jagar.

## Fälttest 9: svårighetsgrader
Normal = nuvarande värden (On foot 6,75 km/h, 6 start / 18 max zombier). **Easy:** fart ×0,9, antal ×0,7. **Hard:** fart ×2 (On foot 13,5 km/h, Bike 31,6 km/h – mycket snabbt), antal ×2 (On foot 12 start / 36 max). Samma multiplikatorer för alla aktiviteter (`src/config/difficulty.ts`). I A TO B får korridorspawn 50 m minsta zombieavstånd så att även Hard-antalet får plats mellan A och B.

## Fälttest 10: slumpade skrämmor
1–2 per match (planeras vid start, `planScares`): första efter 90–420 s speltid, andra (50 %) 240–480 s senare. Skrämman visas först när en zombie närmar sig (≤ 200 m) efter planerad tid, så den känns motiverad. Visas ~1,3 s: bild `public/img/jump.svg` + skrik `public/audio/jump-scream.wav` (följer ljudknappen) + vibration. Blockerar inte spelet (matchen pausas inte, inga klick fångas). **Aldrig på Bike** (säkerhet) och kan stängas av i NEW GAME ("Random jump scares", sparas lokalt). Loggas som `jump_scare` i testloggen.

## Fotorealistiska bilder (jump scare + startsida)
- `public/img/jump.jpg` (närbild ansikte) och `public/img/hero.jpg` (startsidans bakgrund) är bearbetade från ett CC0-foto (Wikimedia Commons, zombie-makeup). Källa anges under HOW TO PLAY → Credits.
- SVG-versionerna finns kvar som reserv om jpg saknas. Byt filerna för egna foton (samma filnamn).

## Ljud och capture-bild (fälttest)
- Capture-skärmen visar nu ett foto (`public/img/captured.jpg`, tätare utsnitt ur samma CC0-foto); SVG är reserv.
- Endast tre ljud finns kvar: "zombie" en gång per match i början, captured-skriket och jump-skriket. Varningspip (hunting, sprint, närkontakt), checkpoint, extraction och match over är ljudlösa (vibration finns kvar).

## Zombiefarter (ny tabell)
Zombiefart km/h (`ZOMBIE_SPEED_KMH` i `src/config/game-rules.ts`): On foot easy 6 / normal 10 / hard 13; Bike easy 14 / normal 17 / hard 24. Spurt = ×1,5 (`SPRINT_SPEED_FACTOR`), 30 s, vila 30 s, radie 100 m. Spurtfart: foot 9 / 15 / 19,5; bike 21 / 25,5 / 36 km/h. Antal zombies per nivå oförändrat (0,7× / 1× / 2×).

## Capture-flöde och HUD
- Captured: bilden visas 3 s (timern startar en gång; tidigare kunde omrenderingar vid varje GPS-uppdatering starta om den), därefter dialogen GAME OVER med sammanfattning och knapparna HOME / PREVIOUS GAMES.
- Topprad: närmaste zombie (avstånd, alla zombies, alltid synligt) och på Bike spelarens fart i km/h (`src/play/speed.ts`, jämnad GPS-fart, annars härledd ur positioner; "– km/h" utan färsk mätning).

## Bike-zoom (endast Bike)
- Spelaren i mitten av skärmen, Track Up och samma pil. Zoomen räknas fram (`bikeZoom` i `src/play/bike-view.ts`) så att 500 m framåt och 500 m bakåt ryms mellan skärmens mitt och över-/underkant (på en 390 px bred telefon blir det ca ±230 m åt sidorna).
- Drar/zoomar man kartan ligger den kvar; efter 6 s utan beröring (`BIKE_VIEW_RETURN_S`) glider den tillbaka till spelaren och grundzoomen. ⌖-knappen återgår direkt. On foot är oförändrat.
- E2E: `e2e/bikezoom.e2e.mjs` (mockad GPS).

## Bike-zoom v2, nya bilder, spänningsljud
- Bike: normalvy 1 km framåt och 1 km bakåt (`BIKE_VIEW_AHEAD_M`), spelaren i mitten, Track Up alltid. När närmaste zombie är inom 200 m zoomar kartan in till ca 300 m framåt (spelaren kvar i mitten); den zoomar ut igen först över 260 m (hysteres). Mjuk övergång (700 ms).
- Ljud `tension.wav` (otäck dröne + dova hjärtslag, 2,4 s) spelas vid inzoomningen, högst en gång per 45 s, och följer ljudinställningen.
- Capture-bild: CC BY-foto av en grön zombiemask (Sharpshotefx) i stället för det blodiga CC0-fotot. Startsida: ljusare CC BY-foto (Heath Cajandig). Jump scare använder fortfarande det första CC0-fotot. Attribution under HOW TO PLAY → Credits.
- E2E-skripten kräver en ren server på port 3100; en gammal serverprocess gav tidigare falska fel (CSS/JS-chunks med fel MIME-typ).
