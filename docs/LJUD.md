# Ljudbild – OUTBREAK (vuxenappen)

Gäller bara vuxenappen. Mini Outbreak har kvar sitt eget ljudpaket (`apps/mini/src/client/sounds.ts`) och laddar ingen av filerna nedan.
Källfiler, nivåer och storlekar: [`assets/audio/README.md`](../assets/audio/README.md).

## Arkitektur

| Del | Fil | Ansvar |
| --- | --- | --- |
| Ljudmotor | `src/audio/soundscape.ts` | En AudioContext, bussar (musik, hot, helikopter, effekter), säkerhetslimiter, one-shots, loopar med övertoning, menymusik, duckning. Inga spelregler. |
| Regler | `src/play/sound-rules.ts` | Alla avstånd och tider (`SOUND_RULES`), hotpulsens tillstånd, närhets-cooldown. Ren TypeScript, testad. |
| Kontroller | `src/app/_client/audio.ts` | Filer, mix, nivåer per ljud, sparade inställningar, `MatchAudio` (matchens ljud). |
| Tal och vibration | `src/app/_client/cues.ts` | Talsyntesen (befintlig) med radioklick före och duckning under; vibration. Spelar inga ljudfiler själv, så inget hörs dubbelt. |
| Spelhändelser | `src/play/session.ts` (`SoundEvent`, `onSound`) | Sessionen säger till i samma ögonblick som spelet bestämmer en händelse. |
| Sidnivå | `src/app/_client/AudioDirector.tsx` | Menymusik över sidbyten, upplåsning vid tryck, förladdning under inställningarna. |
| Inställningar | `src/app/_client/SoundSettings.tsx` | SOUND på startsidan: allt av/på, musik, effekter, röst. |

`src/audio/cue-player.ts` (delad med Mini) har bara fått valfria fält (`context`, `onSpeech`, `voice.volume`). Utan dem beter den sig som förut.

## Händelser

| Ljud | Spelhändelse (kod) | Regel |
| --- | --- | --- |
| theme-outbreak | Menysidor (allt utom `/play`, `/field`, `/dev`) | Startar vid första trycket. Fortsätter över sidbyten utan omstart. På `/play` spelar den bara medan en ny match väntar på sin första position. Tonas ut på 2,5 s när matchen startar och tonas in igen (3 s) på menyn efter matchen. |
| threat-pulse-1…4 | Närmaste zombie (samma tal som HUD:en visar) | Se *Hotpuls*. |
| zombie-near | Närmaste zombie inom 100 m till fots / 200 m på cykel (samma gränser som kartans inzoomning, ut igen bortom 130 / 260 m) | En gång per närmande, 45 s cooldown, högst 8 per match. Följer bara närmaste avståndet, så många zombier ger ett ljud. |
| position-revealed | Första `zombie_detected` i matchen (jakten börjar, zombierna har positionen) och `off_network: exposed` ("Zombies have found you") | 60 s cooldown. Väntar tills operatörens röst ("Game on") har talat klart, högst 4 s. Det periodiska `reveal`-eventet används inte: med magnetjakt vet zombierna redan var spelaren är, så det vore ett ljud utan innebörd (V2.2-ANALYS 5). |
| checkpoint-reached | `objective_reached` för ett mål av typen checkpoint | En gång per nådd checkpoint. Hem och B räknas inte, de ger vinstljudet. Den befintliga rösten "Checkpoint" följer efter 1 s. |
| radio-open | Före operatörens tal (talsyntesen) | Rösten börjar 0,45 s efter klicket. Inget nytt klick inom 8 s efter förra repliken. Inte före "Captured". Talsyntesen har ingen egen radioeffekt, så det blir ingen dubbel effekt. |
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
- **Zombiespurt** hade ett skrik. Nu hörs bara rösten "Run!" (med radioklick) och vibrationen.
- **"tension"** vid inzoomningen ersätts av zombie-near vid samma gränser.
- Det gamla närhetsljudet (en gång per match vid 500/1 000 m) är nu bara vibration. 500 m är inte "nära håll".

### Infektion

Det finns ett separat infektionsskede: `infection_contact` (zombien är i kontakt, infektionen räknas, mätaren `.infect` fylls). Varningen är oförändrad: vibration, texten "Zombie close – move away!" och nedräkningen 10 m i tal. Det finns ingen ljudfil för infektionsstart, och `captured` används inte som tidig varning. **Lucka:** ingen egen ljudsignal när infektionen börjar.

## Hotpuls

- Till fots startar en hotperiod när närmaste zombie har varit inom 200 m i 3 s. Den slutar när zombien har varit bortom 260 m i 10 s och perioden har pågått minst 12 s. 200 m är samma avstånd som "Zombies approaching" redan sägs vid, och motsvarar ungefär 70 s rakt mot varandra mot en Normal-zombie (5,6 km/h) i gångfart.
- På cykel gäller 400 m / 500 m: spelaren rör sig i cirka 16 km/h och zombien i 7,8–13,4 km/h, så 400 m motsvarar ungefär 55–65 s rakt mot varandra.
- Efter en period följer minst 20 s lugn, utom när en zombie redan är inom inzoomningsavståndet (100 / 200 m).
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

Duckning: under tal och radioklick sänks musik, hot och helikopter till 0,32 (≈ −10 dB) på 0,15 s och återställs på 0,9 s. Duckningen släpps automatiskt efter 8 s om talsyntesen aldrig meddelar att den är klar (det händer på Android). Efter mixen sitter en säkerhetslimiter (DynamicsCompressor, −6 dB, 12:1).

Lyssnarens nivåer (0–100 %) multipliceras på mixen. "Effects" styr bussarna fx, threat och heli, och "Voice" styr talsyntesens volym. Allt av/på sparas i den befintliga nyckeln `outbreak.cues`, så ett tidigare val gäller. Nivåerna sparas i `outbreak.audio.levels`. Ljud är på som standard, men inget spelas före ett tryck.

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

## Provlyssning i riktig telefon (återstår)

1. Nivåbalansen mellan musik, puls, helikopter, händelser och röst, i högtalare och i hörlurar.
2. Hörs talet tydligt över helikopterloopen? Är −10 dB duckning lagom?
3. Skarvarna i hotpulsernas och helikopterns loopar (övertoning 0,12 / 0,35 s). Det gäller särskilt den rytmiska puls 2, där överlappet förskjuter takten en aning vid varje varv.
4. Musikens upprepning vid ≈ 3:27. Låter övergången diskret?
5. iPhone: ring/tyst-omkopplaren tystar Web Audio, även musiken. Kontrollera också musiken efter samtal/Siri, och efter att skärmen släckts och tänts.
6. Android: talsyntesens start- och slutsignaler (duckningen), och att ingen kvarhängande duckning ligger kvar.
7. Positionsljudet vid matchstart: känns det motiverat, eller är det ett ljud för mycket direkt efter "Game on"?
8. Dörrsmällen är limiterad och ändå ≈ 5 dB svagare än de andra händelseljuden. Är den tillräckligt tydlig?
9. Cykel: räcker 400 m för hotpulsen, eller kommer den för tidigt eller sent i verklig fart?
