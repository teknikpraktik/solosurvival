# Ljudbild – OUTBREAK (vuxenappen)

Gäller bara vuxenappen. Mini Outbreak har kvar sitt eget ljudpaket (`apps/mini/src/client/sounds.ts`) och laddar ingen av filerna nedan.
Källfiler, nivåer och storlekar: [`assets/audio/README.md`](../assets/audio/README.md).

## Arkitektur

| Del | Fil | Ansvar |
| --- | --- | --- |
| Ljudmotor | `src/audio/soundscape.ts` | En AudioContext, bussar (musik, hot, helikopter, effekter), säkerhetslimiter, one-shots, loopar med övertoning, menymusik, duckning. Inga spelregler. |
| Regler | `src/play/sound-rules.ts` | Alla avstånd och tider (`SOUND_RULES`), hotpulsens tillstånd, närhets-cooldown. Ren TypeScript, testad. |
| Kontroller | `src/app/_client/audio.ts` | Filer, mix, nivåer per ljud, sparade inställningar, `MatchAudio` (matchens ljud). |
| Vibration | `src/app/_client/cues.ts` | Bara vibration. Appen har ingen syntetisk röst (talsyntes): allt som sägs är inspelade repliker. |
| Spelhändelser | `src/play/session.ts` (`SoundEvent`, `onSound`) | Sessionen säger till i samma ögonblick som spelet bestämmer en händelse. |
| Sidnivå | `src/app/_client/AudioDirector.tsx` | Menymusik över sidbyten, upplåsning vid tryck, förladdning under inställningarna. |
| Inställningar | `src/app/_client/SoundSettings.tsx` | SOUND på startsidan: allt av/på, musik, effekter, röst. |

`src/audio/cue-player.ts` (delad med Mini) har bara fått valfria fält (`context`, `onSpeech`, `voice.volume`). Utan dem beter den sig som förut.

## Händelser

| Ljud | Spelhändelse (kod) | Regel |
| --- | --- | --- |
| theme-outbreak | Hela appen utom `/field` och `/dev` | **Startar direkt när appen öppnas** där webbläsaren tillåter ljud utan tryck. iPhone och de flesta mobiler tillåter det inte, och där startar musiken vid första trycket var som helst i appen. Den börjar efter filens 4 s tystnad, tonas in på 3 s och upprepas på menyn med 3,5 s övertoning. **Matchstart:** ingen uttoning; låten spelar klart parallellt med matchen och börjar inte om. **Matchslut:** när slutljud och slutreplik är klara (högst 15 s) kommer musiken tillbaka och upprepas. Spelade den fortfarande, fortsätter den bara. |
| threat-pulse-1…4 | Närmaste zombie (samma tal som HUD:en visar) | Se *Hotpuls*. |
| zombie-near | Närmaste zombie inom 100 m till fots / 200 m på cykel (samma gränser som kartans inzoomning, ut igen bortom 130 / 260 m) | En gång per närmande, 45 s cooldown, högst 8 per match. Följer bara närmaste avståndet, så många zombier ger ett ljud. |
| position-revealed | Första `zombie_detected` i matchen (jakten börjar, zombierna har positionen) och `off_network: exposed` ("Zombies have found you") | 60 s cooldown. Väntar tills operatörens röst ("Game on") har talat klart, högst 4 s. Det periodiska `reveal`-eventet används inte: med magnetjakt vet zombierna redan var spelaren är, så det vore ett ljud utan innebörd (V2.2-ANALYS 5). |
| checkpoint-reached | `objective_reached` för ett mål av typen checkpoint | En gång per nådd checkpoint. Hem och B räknas inte, de ger vinstljudet. Den befintliga rösten "Checkpoint" följer efter 1 s. |
| (radio-open) | – | Borttagen ur appen: klicket inledde bara talsyntesen. Källfilen finns kvar i `assets/audio/source/`. |
| heli-approach | Helikopterkortet "approaching" (60 s speltid före extraction) | En gång per match, från samma tick som kortet. |
| heli-extraction | Fasen `extraction` i Survival | Loop medan räddningen är öppen. Tonas in på 3 s när helikoptern landat, och ankomstljudet tonas ut på 3 s. En återställd match i den fasen får loopen utan ankomstljudet. |
| heli-extraction-success | `finished: survived` i Survival | En gång. Loopen avslutas (0,8 s). |
| safe-door-close | `finished: survived` i Checkpoints (hemma) och A TO B (vid B) | En gång. |
| captured | `finished: infected` | En gång, i samma ögonblick som skrämbilden (den skickas nu direkt när matchen avgörs, inte efter att resultatet sparats). |
| – | `finished: failed` (tiden slut), `aborted` (QUIT) | Inget ljud. Allt matchljud stängs av. |

Bilder och ljud utgår från samma händelse. Inget ljud väntar på att en bild laddats. Ett ljud som fortfarande avkodas får starta högst 1,5 s sent (resultatljud 2,5 s, helikopterns ankomst 4 s), annars hoppas det över.

### Borttaget

De gamla genererade ljuden (`captured-scream`, `jump-scream`, `sprint-shriek`, `tension`, `checkpoint`, `zombie-near` i WAV) och `scripts/make-audio.mjs` är borttagna. Det har följande konsekvenser:

- **Jump scare** (den slumpade skrämbilden) har inget eget ljud längre, bara bild och vibration. Inget av de levererade ljuden är avsett för den.
- **Zombiespurt** hade ett skrik. Nu finns bara vibrationen (ingen röst).
- **"tension"** vid inzoomningen ersätts av zombie-near vid samma gränser.
- Det gamla närhetsljudet (en gång per match vid 500/1 000 m) är nu bara vibration. 500 m är inte "nära håll".

### Infektion

Det finns ett separat infektionsskede: `infection_contact` (zombien är i kontakt, infektionen räknas, mätaren `.infect` fylls). Varningen är vibration och mätaren; zombie-near hörs vid 100 m (200 m på cykel). Det finns ingen ljudfil för infektionsstart, och `captured` används inte som tidig varning. **Lucka:** ingen egen ljudsignal när infektionen börjar.

## Operatörens radiorepliker

Åtta inspelade repliker (`VOICE` i `src/app/_client/audio.ts`). Radioeffekten finns redan i filerna: 80–94 % av energin ligger i
300–3 400 Hz, och brus eller knaster kommer före talet. Därför läggs inget radioklick till. Texten nedan är maskintranskriberad med
Whisper small.en i den här miljön; ingen har lyssnat.

| Fil | Tal (transkriberat) | Spelhändelse |
| --- | --- | --- |
| keep-moving | "You're on your own out there. Keep moving. Stay alive." | Survival: `match_started`, när matchen faktiskt startar. Det sker en gång per match: vid START eller autostart, aldrig vid fortsättning efter paus och aldrig för en återställd match som redan pågår. Den ersätter talet "Game on". |
| safehouse-on-map | "Safe house marked on your map. Get there alive." | A TO B: `match_started` (B är satt och syns på kartan). Den ersätter "Game on". |
| checkpoint-secured | "Checkpoint secured. Keep moving." | `objective_reached` för en checkpoint, efter att spelet bekräftat den (30 m i 5 s). Den ersätter checkpoint-klangen och talet "Checkpoint". |
| get-to-safehouse | "All checkpoints secured. Get to the safe house." | Samma händelse för den sista checkpointen, när nästa mål är hem (`last`). Den ersätter checkpoint-secured. |
| rescue-inbound | "Rescue inbound. Stand by for the extraction point." | Survival: helikopterkortet "approaching", 60 s speltid före landningen och från samma tick som kortet. |
| get-to-helicopter | "We're down. Get to the helicopter. We can't stay long." | Survival: `extraction_opened`, med kortet "landed". Den avbryter och ersätter en rescue-inbound som fortfarande spelas eller väntar. Den ersätter talet "Run!" vid landningen. |
| lifting-off | "Lifting off. You made it." | `finished: survived` i Survival, alltså först när vinstvillkoret (30 m i 5 s vid helikoptern) är uppfyllt. Den spelas med extracted-bilden och helikopterns lyftljud. |
| inside-safehouse | "You're inside. Lock the door. You made it." | `finished: survived` i Checkpoints (hemma) och A TO B (vid B). Den spelas med safehouse-bilden och dörrsmällen. |
| checkpoint-start | "Checkpoints marked on your map. Secure them all, then get to the safe house. Stay alive." | Checkpoints: `match_started`, en gång när matchen startar. |


### Nedräkning (zombiens avstånd)

Fem inspelade ord: "fifty", "forty", "thirty", "twenty" och "ten" (`count50` … `count10` i `VOICE`). Närmaste zombies avstånd, samma som HUD:en visar, sägs när det passerar 50, 40, 30, 20 och 10 m (`VOICE_COUNTDOWN_M` i `src/play/countdown.ts`).
- Varje steg sägs en gång per närmande. Vid ett snabbt närmande sägs bara det närmaste steget, ingen eftersläpning.
- Ett steg kan sägas igen först när zombien har dragit sig minst 5 m bakom det (skydd mot GPS-brus).
- Inget sägs i paus, när appen är i bakgrunden eller när ljudet är av.
- Nedräkningen är brådskande: den avbryter en pågående replik och kastar en väntande, men aldrig vinstrepliken.
- **Filnamnen stämde inte med innehållet.** Tre taligenkänningsmodeller (Whisper base, small och medium) är överens: uppladdade "10.mp3" säger "fifty", "20.mp3" säger "forty", "40.mp3" säger "twenty" och "50.mp3" säger "ten"; bara "30.mp3" stämmer. Filerna är kopplade efter vad som sägs, och källfilerna heter efter det (`countdown-50.mp3` = "fifty"). Ingen har lyssnat.

### Röstkanalen

- **En replik åt gången.** En replik som kommer medan en annan spelar väntar på en enda köplats, där den nyaste vinner. Väntar den mer än 12 s kasseras den.
- **Inaktuella repliker kasseras på händelser:** matchslut, fångst, Quit, när spelskärmen lämnas, när appen hamnar i bakgrunden, och när landningen ersätter "rescue inbound".
- **Vinstrepliken är en del av slutsekvensen.** Den avbryter allt annat. Den stoppas när slutet lämnas (SHOW MATCH, PLAY AGAIN, Main menu) och vid fångst.
- **Ingen syntetisk röst.** Talsyntesen används inte alls i vuxenappen (borttagen 2026-11-14): inte "Game on", "Zombies approaching", nedräkningen 100–10 m, "Run!", "Checkpoint" eller "Captured". Varningarna i den finns kvar som vibration, hotpuls och zombie-near.
- **Ljudnivåer:** egen röstbuss. Rösten följer reglagen Voice och "Sound on". Musik, hotpuls och helikopter sänks med ≈ 10 dB medan repliken spelar och återställs när den slutar eller stoppas; det finns en säkerhetsgräns på 12 s. Effekter och varningsljud sänks inte.
- **Händelser från bakgrunden** (räknade vid återkomst) ger ingen replik.
- **Saknad eller trasig fil:** vid en checkpoint spelas den gamla klangen i stället; för övriga repliker blir det tyst. Spelets regler påverkas aldrig. Avstängt ljud ger ingen ersättning.
- **Undertexter:** spelvyn har inget system för undertexter. Sessionens korta meddelanden visas aldrig där, så inga undertexter har lagts till. Repliktexten finns i `VOICE` och i fältloggen (`sound` → `voice`).

### Radiobrus och nivå (efter fälttestet)

Radiobruset upplevdes för högt. Två ändringar:
- **Brusdämpning i filerna:** varsam nedåtexpansion vid bygget (`VOICE_GATE` i `scripts/build-audio.mjs`). Brus långt under talet sänks 2:1, högst 9 dB. Uppmätt: talet är oförändrat (±0,0 dB), och bruset mellan orden har sänkts 4–9 dB i sex filer. I keep-moving och get-to-helicopter ligger bruset nära talets nivå, så där blev sänkningen bara 0,6–1,2 dB.
- **Lägre nivå i mixen:** alla repliker ligger 2,5 dB lägre (röstnivå 0,75).

## Hotpuls

- Till fots startar en hotperiod när närmaste zombie har varit inom **300 m** i 2 s. Den slutar när zombien har varit bortom 380 m i 8 s och perioden har pågått minst 12 s. Gränserna vidgades efter fälttestet, så att pulsen hörs oftare: 300 m motsvarar ungefär 100 s rakt mot varandra i gångfart mot en Normal-zombie.
- På cykel gäller **600 m / 750 m**: spelaren rör sig i cirka 16 km/h och zombien i 7,8–13,4 km/h, så 600 m motsvarar ungefär 85–100 s rakt mot varandra.
- Efter en period följer minst **8 s** lugn, utom när en zombie redan är inom inzoomningsavståndet (100 / 200 m).
- Varje period får en slumpad variant, aldrig samma två gånger i rad. Bara en variant hörs åt gången. Den tonas in på 2,5 s och ut på 4 s.
- Paus, matchslut, inga zombier eller appen i bakgrunden stoppar pulsen med en snabb uttoning (1,2 s). Därefter krävs de 3 s igen.
- Reglerna körs varje sekund av `MatchAudio`, även när ingenting på skärmen ändras (en stillastående zombie).
- Pulsen bygger på samma avstånd som HUD-pillret alltid visar. Ljudet avslöjar alltså ingenting som skärmen inte redan visar.
- Tonhöjd och uppspelningshastighet ändras aldrig.

## Mix

| Buss | Nivå | Duckas under tal |
| --- | --- | --- |
| music | 0,32 | ja |
| threat | 0,70 | ja |
| heli | 0,80 | ja |
| fx (händelser, radio) | 1,0 | nej |

Nivå per ljud på sin buss: hotpuls 1,0, helikopterloop 0,7, helikopterns ankomst 0,9, success/captured/dörr 1,0, zombie-near 0,8, revealed 0,75, checkpoint 0,7, radio 0,55.

Duckning: under operatörens repliker sänks musik, hot och helikopter till 0,32 (≈ −10 dB) på 0,15 s och återställs på 0,9 s. Duckningen släpps automatiskt efter 8 s om talsyntesen aldrig meddelar att den är klar (det händer på Android). Efter mixen sitter en säkerhetslimiter (DynamicsCompressor, −6 dB, 12:1).

Lyssnarens nivåer (0–100 %) multipliceras på mixen. "Effects" styr bussarna fx, threat och heli, och "Voice" styr röstbussen (operatörens repliker). Allt av/på sparas i den befintliga nyckeln `outbreak.cues`, så ett tidigare val gäller. Nivåerna sparas i `outbreak.audio.levels`. Ljud är på som standard, men inget spelas före ett tryck.

## Livscykel

- **Start:** AudioContext och musikelement skapas och låses upp vid första trycket (`pointerup`/`touchend`/`click`/`keydown`). Spelas något utan tryck blockeras det tyst och görs om vid nästa tryck.
- **Avslut, QUIT, Play again och Main menu:** alla loopar och väntande ljud stoppas, och tidtagaren stannar. En ny match börjar utan kvarvarande tillstånd (`MatchAudio.newMatch`).
- **Bakgrund:** inga nya ljud medan appen är dold. Loopar och musik pausas, och ett väntande radiomeddelande släpps. Vid återkomst märks de händelser som sessionen räknar fram för tiden borta med `stale` och ger inget ljud. Undantaget är matchens resultat, som visas nu och därför hörs. Pulsen och helikoptern kommer tillbaka med sina vanliga regler.
- **Fel:** saknade filer, blockerad uppspelning och avbrutet ljud (iOS) kastar aldrig. `wake()` försöker återuppta kontexten före varje ljud, och varje tryck försöker igen.

## Filer, cache och offline

- Produktionsfilerna ligger i `public/audio/` (MP3). Originalen ligger i `assets/audio/source/` och ingår inte i bygget.
- Service workern cachar `/audio/` vid första hämtningen, som förut. Den nya versionen rensar de gamla WAV-filerna ur cachen.
- Musiken hämtas med `fetch` och spelas från en blob-URL. Den fungerar då offline, och mediaelementet skickar inga range-förfrågningar som cachen inte kan besvara.
- Musiken hämtas när appen öppnas, men bara om ljud och musik är på. Matchljuden avkodas under inställningarna (`/new`) och helikopterns filer när en Survival-match startar. Inget av det blockerar gränssnittet.

## Verifiering

Allt nedan har körts här. Ingenting har provlyssnats.

- `src/tests/unit/sound-rules.test.ts`: hotregler (dwell, hysteres, minsta längd, lugn period, variant aldrig två gånger i rad), närhets-cooldown och tak.
- `src/tests/unit/soundscape.test.ts`, på en fejkad Web Audio-klocka:
  - inget ljud före tryck, utan ljud påslaget eller i bakgrunden;
  - loop med överlapp bara vid skarven och ingenting kvar efter stopp;
  - duckning med säkerhetsgräns, och att nivåerna följer inställningarna;
  - musiken: startar en gång, ingen omstart vid sidbyten, upprepning med övertoning, uttoning och intoning, blockerad uppspelning, bakgrund;
  - matchljud: en hotpuls åt gången, närhetsljud en gång, helikopterns faser, rätt vinstljud per läge, inaktuella händelser tysta, QUIT och ny match rena, paus och bakgrund, ljud av.
- `src/tests/unit/sound-events.test.ts`, sessionen på riktig kartdata: helikopterns ankomst och landning en gång, jakten och "exposed", checkpoint men inte hem, slutet i samma ögonblick, `stale` vid återkomst från bakgrunden.
- `e2e/audio.e2e.mjs`, byggd app i Chromium med mockad GPS: musikens livscykel över sidor, hämtade filer, hotpuls från en placerad zombie, QUIT, Survival-faserna, sparat "ljud av". Skriptet kontrollerar vad som spelar, inte hur det låter.

Radiorepliker: `soundscape.test.ts` (en replik åt gången, kö och kassering, vinstrepliken avbryter, Quit och fångst tystar, saknad fil
ger ersättning, avstängt ljud, bakgrund, duckning släpps), `sound-events.test.ts` (start en gång, inte efter paus, sista checkpointen) och
`e2e/audio.e2e.mjs` (A TO B, Checkpoints, Survival, fångst och ny match, Quit medan en replik spelar och en väntar).

## Provlyssning i riktig telefon (återstår)

1. Nivåbalansen mellan musik, puls, helikopter, händelser och röst, i högtalare och i hörlurar.
2. Hörs talet tydligt över helikopterloopen? Är −10 dB duckning lagom?
3. Skarvarna i hotpulsernas och helikopterns loopar (övertoning 0,12 / 0,35 s). Det gäller särskilt den rytmiska puls 2, där överlappet förskjuter takten en aning vid varje varv.
4. Musikens upprepning vid ≈ 3:27. Låter övergången diskret?
5. iPhone: ring/tyst-omkopplaren tystar Web Audio, även musiken. Kontrollera också musiken efter samtal/Siri, och efter att skärmen släckts och tänts.
6. Att ingen kvarhängande duckning ligger kvar efter en avbruten replik.
7. Positionsljudet vid matchstart: känns det motiverat, eller är det ett ljud för mycket direkt efter startrepliken?
8. Dörrsmällen är limiterad och ändå ≈ 5 dB svagare än de andra händelseljuden. Är den tillräckligt tydlig?
9. Cykel: räcker 400 m för hotpulsen, eller kommer den för tidigt eller sent i verklig fart?
10. Radiorepliker: nivån mot musik, hotpuls och helikopter; att transkriptionen stämmer. Talet börjar 1,6–3,9 s in i filerna efter brus och knaster, så "You're inside" kommer cirka 4 s efter dörrsmällen. Är det rätt tempo?
11. Survival-vinsten: "Lifting off" spelas samtidigt med helikopterns lyftljud. Hörs rösten tydligt?
