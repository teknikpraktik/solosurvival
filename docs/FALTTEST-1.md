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
