# Ljudinventering – Outbreak och Mini Outbreak

Underlag för ljuduppdraget (branch `feature/audio-production`). Inventerat 2026-10-29 mot `feature/mini-outbreak` @ `8305b53`
(PR #48, ännu inte mergad till `master`). Där finns `apps/mini/`, `src/audio/cue-player.ts` och `apps/mini/src/client/sounds.ts`;
på `master` finns bara `src/app/_client/cues.ts` med egen uppspelning. Radnummer gäller den commiten.

## 1. Befintligt ljudsystem

Det finns **ett** ljudsystem, och det ska byggas ut i stället för att ersättas.

| Del | Fil | Vad den gör |
| --- | --- | --- |
| Gemensam spelare | `src/audio/cue-player.ts` | `createCuePlayer(pack)`: en `AudioContext`, avkodade buffertar per cue, väckning av en avstängd kontext (`wake`, iOS), syntetisk reservton, vibration, talsyntes (`speechSynthesis`) med en tyst första replik som låser upp talet, och av/på i `localStorage`. |
| Ljudpaket, vuxen | `src/app/_client/cues.ts` | `OUTBREAK_SOUNDS`: 6 WAV-filer (`public/audio/`), vibrationsmönster, `audible`-mängd, volym per cue, låg engelsk röst (pitch 0.5). Repliker: `Game on`, `Captured`, `Zombies approaching`, `Run!`, `Checkpoint`, `100`…`10`. |
| Ljudpaket, Mini | `apps/mini/src/client/sounds.ts` | `MINI_SOUNDS`: bara `checkpoint.wav` hörs; allt annat vibrerar. Repliker: `Game on`, `Checkpoint`, `Watch out!`, `Caught! Try again!`, `You made it!`. |
| Händelsekälla | `src/play/session.ts` | `PlaySession.endMatch()` översätter motorns `GameEvent` till `Cue` + text via `onCue`. `checkZombies()` ger närhetsljud och skrämmor. |
| Klientkoppling | `src/app/_client/SessionProvider.tsx:42–48`, `apps/mini/src/client/SessionProvider.tsx:40–43` | `onCue` → `playCue(cue)`, plus talad `Checkpoint` (1 s efter klangen) och `Run!` (vuxen). |
| Avståndslogik i UI | `src/app/play/Play.tsx:60–106`, `apps/mini/src/app/play/Play.tsx:55–83`, `src/play/camera-view.ts`, `src/play/countdown.ts` | Spänningsljud, "Zombies approaching"/"Watch out!" vid 200 m, nedräkning 100…10 m, fångad, vinst (Mini). |
| Inställning | `NewGame.tsx` (kryssruta), `Play.tsx` (🔊/🔇) | `setCuesEnabled` i `localStorage` (`outbreak.cues`, `mini-outbreak.cues`). |
| Offline | `public/sw.js`, `apps/mini/public/sw.js` | `/audio/*` cachas *när den hämtas* (stale-while-revalidate). Ingen förcachning vid installation. `preloadCues()` hämtar alla filer i paketet efter första tryckningen, så de hamnar i cachen under första matchen. |
| Generering idag | `scripts/make-audio.mjs` | Syntetiserar WAV-filerna deterministiskt (inga beroenden). |

**Ingen ny ljudmotor behövs.** Det som saknas för ElevenLabs-filerna: flera varianter per cue, prioritet/kö så att två röster
aldrig hörs samtidigt, och uppspelning av röstfiler (tal går idag via `speechSynthesis`, som låter olika på varje telefon). Se
[AUDIO-DESIGN.md](AUDIO-DESIGN.md) §4.

## 2. Händelser

Kolumnen *Status* anger om händelsen finns i koden och om den hörs:
**ljud** = har ljud eller tal idag · **tyst** = händelsen finns och kan identifieras tillförlitligt, men ger bara vibration eller ingenting ·
**förslag** = finns inte som händelse och kräver ny kod (implementeras inte utan godkännande).

| Händelse-ID | Beskrivning | Utlösande kod | Nuvarande ljud (Adult / Mini) | Föreslaget ljud | Prio | Cooldown | Produkt | Status | Risker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `match.start` | Spelaren trycker START | `Play.tsx:206/222` (vuxen), `apps/mini/.../Play.tsx:123` | tal "Game on" / tal "Game on" | `*.vo.game_start` (+ `mini.sfx.game_start`) | P1 | – | båda | ljud | Spelas i en gest: säkert på iOS. |
| `match.resume` | CONTINUE efter paus | samma knappar | – / – | `*.vo.resume` | P3 | 10 s | båda | tyst | – |
| `match.pause` | PAUSE-knappen | `Play.tsx:208`, Mini `:181` | – / – | `*.vo.pause` | P3 | 10 s | båda | tyst | Ska inte spelas när paus beror på bakgrund (inget hörs då ändå). |
| `enemy.first_contact` | Första zombie inom närhetsradien, en gång per match | `session.ts:552` (`zombie`) | `zombie-near.wav` / vibration | `adult.enemy.growl` + `adult.vo.first_contact`; `mini.vo.first_contact` | P2 | 12 s (gruppering) | båda | ljud / tyst | – |
| `enemy.approach` | Närmaste zombie inom 200 m (hysteres 260 m) | `Play.tsx:78–91`, Mini `:66–77`, `camera-view.ts:33–45` | tal "Zombies approaching" / tal "Watch out!" | `*.vo.enemy_nearby`; Mini även `mini.sfx.warning` + typens läte | P2 | 30 s | båda | ljud | Kräver inte att spelaren tittar. |
| `enemy.detected` | Zombie upptäcker spelaren (motorn `zombie_detected`) | `session.ts:499–502` | vibration / vibration | `adult.vo.hunted` | P2 | 15 s idag, föreslås 60 s | vuxen | tyst | Kan sammanfalla med `enemy.approach`: spärra 10 s efter den. Mini: ingen röst (för pratigt). |
| `enemy.contact` | Infektion börjar räknas (motorn `infection_contact`) | `session.ts:503` (`danger`) | vibration / vibration | `*.sfx.warning` + `*.vo.danger_close` | P0 | 8 s | båda | tyst | Viktigaste saknade ljudet: spelaren kan bli fångad utan att höra något. |
| `enemy.countdown` | Avstånd 100/50/40/30/20/10 m | `Play.tsx:93–98`, `countdown.ts` | tal "100"…"10" / – | `adult.vo.countdown` | P0 | hysteres i `countdown.ts` | vuxen | ljud | Nyare steg ska avbryta äldre. Mini har medvetet ingen nedräkning. |
| `enemy.close_tension` | Kameran zoomar in (100 m fot, 200 m cykel) | `Play.tsx:63–71` | `tension.wav` / – | `adult.sfx.tension` | P4 | 45 s | vuxen | ljud | – |
| `enemy.sprint` | Zombie spurtar | `session.ts:506–509`, `SessionProvider.tsx:47` | `sprint-shriek.wav` + tal "Run!" / vibration | `adult.enemy.sprint_shriek` + `adult.vo.sprint`; `mini.vo.sprint` | P2 | 25 s | båda | ljud / tyst | **"Run!" uppmanar till att springa.** Nya repliker undviker ordet. |
| `enemy.reveal` | Zombierna får spelarens position (var 60–180 s) | `engine.ts:236–242` (`reveal`), hanteras inte i `session.ts` | – / – | `adult.enemy.distant_scream` | P4 | 90 s | vuxen | förslag | Kräver att `session.ts` släpper igenom händelsen. Bara atmosfär. |
| `enemy.spawned` | Ny zombie skapas | `session.ts:504` (logg) | – / – | Inget ljud | – | – | – | tyst | Sker ofta och långt bort: ett ljud skulle bara störa. Den spelrelevanta signalen är `enemy.approach`. |
| `scare.jump` | Slumpad skrämma (aldrig cykel, aldrig Mini) | `session.ts:554–559` | `jump-scream.wav` + bild / – | `adult.enemy.jump_scream` | P4 | planeras 1–2 per match | vuxen | ljud | **Plötsligt starkt ljud utomhus.** Begränsad volym, får aldrig avbryta tal. Se AUDIO-DESIGN §6. |
| `objective.checkpoint` | Checkpoint nådd (Mission) | `session.ts:498`, `SessionProvider.tsx:46` | `checkpoint.wav` + tal "Checkpoint" / samma | `*.sfx.checkpoint` + `*.vo.checkpoint` | P3 | – | båda | ljud | – |
| `objective.all_checkpoints` | Sista checkpoint, hem återstår | `session.ts:573` (text "All checkpoints found – now head home!") | klang + "Checkpoint" / samma | `*.vo.all_checkpoints` | P3 | – | båda | ljud | Idag samma tal som vanlig checkpoint. |
| `extraction.opened` | Extraction öppnar (Survival, ca 80 % av tiden) | `session.ts:512` (`info`) | vibration / vibration | `*.sfx.extraction_open` + `*.vo.extraction_open` | P1 | – | båda | tyst | Spelavgörande information utan ljud idag. |
| `extraction.unavailable` | Ingen säker extraction hittades | `engine.ts:407`, hanteras inte i `session.ts` | – / – | `adult.vo.extraction_unavailable` | P1 | – | vuxen | tyst | Texten måste stämma med regeln (matchen slutar `failed` när tiden går ut). |
| `extraction.soon` | 1 min innan extraction öppnar | – (beräkningsbar ur `rules.extractionOpensAtS`) | – | `adult.vo.extraction_soon` | P1 | – | vuxen | förslag | – |
| `extraction.holding` | Spelaren står i extraction-zonen (5 s hold) | – (`state.extractionHoldS` > 0) | – | `adult.vo.extraction_hold` | P1 | 20 s | vuxen | förslag | – |
| `extraction.closing` | Extraction stänger | **finns inte**: extraction är öppen till matchens slut | – | Ingen. Använd `time.warning`. | – | – | – | – | – |
| `match.won` | `finished` med `survived` | `session.ts:606` (`end`), Mini `Play.tsx:82` | tyst / tal "You made it!" | `adult.sfx.victory` + `adult.vo.victory` / `adult.vo.extracted` (Survival); `mini.sfx.victory` + `mini.vo.victory` | P1 | – | båda | tyst / ljud | – |
| `match.captured` | `finished` med `infected` | `session.ts:605`, `Play.tsx:101–106`, Mini `:81` | `captured-scream.wav` + tal "Captured" / tal "Caught! Try again!" | `adult.enemy.capture` + `adult.vo.captured`; `mini.sfx.caught` + `mini.vo.caught` | P1 | – | båda | ljud | – |
| `match.time_up` | `finished` med `failed` (tiden slut) | `session.ts:606` (`end`) | tyst / tyst | `adult.sfx.game_over` + `adult.vo.time_up`; `mini.vo.time_up` | P1 | – | båda | tyst | – |
| `match.aborted` | Spelaren avslutar | `session.abort()` | tyst / tyst | Inget ljud | – | – | – | tyst | Spelaren har just tryckt själv. |
| `time.warning` | 5 min / 1 min kvar | – (beräkningsbar ur `elapsedS`/`limitS`) | – | `*.vo.time_warning` | P2 | – | båda | förslag | – |
| `gps.lost_long` | GPS borta 60 s; klocka och zombier står still | `session.ts:513`, `engine.ts` (`GPS_LOST_LONG_S`) | vibration / vibration | `*.sfx.gps_lost` + `*.vo.gps_lost` | P1 | 120 s | båda | tyst | Spelaren kan tro att spelet går när det står still. |
| `gps.restored` | GPS tillbaka | – (övergång i `MatchView.gpsLost`) | – | `*.vo.gps_restored` | P1 | 60 s | båda | förslag | Behöver hysteres så att GPS-brus inte ger upprepade meddelanden. |
| `offnet.entered` | Cykel: varaktigt utanför vägnätet | `session.ts:516` | vibration / – | `adult.vo.offnet_entered` | P2 | 30 s | vuxen | tyst | Bara cykel. |
| `offnet.exposed` | Cykel: budgeten slut, zombier kan smitta | `session.ts:517` | vibration / – | `adult.vo.offnet_exposed` | P0 | 30 s | vuxen | tyst | Bara cykel. |
| `offnet.left` | Cykel: tillbaka på nätet | `session.ts:514–518` (ingen cue) | – / – | `adult.vo.offnet_left` | P3 | 30 s | vuxen | tyst | – |
| `app.paused_away` | Återkomst efter lång frånvaro eller fryst app; spelet pausat | `session.ts:437`, `:483` | – / – | `*.vo.paused_away` | P3 | – | båda | tyst | Spelas vid återkomst (när sidan syns). Kräver ingen gest om kontexten fortfarande är upplåst; annars hörs det inte förrän nästa tryck. |
| `match.restored` | Sparad match återställd vid omladdning | `session.ts:664` | – / – | Inget ljud | – | – | – | tyst | Ingen gest har skett efter omladdningen: ljud blockeras ändå. |
| `voice.chain` | Radioklick före/efter operatörsrepliker | – | – | `adult.sfx.radio_in` / `radio_out` | (följer repliken) | – | vuxen | – | En del av röstuppspelningen, inte en egen händelse. |
| `match.playing` | Bakgrundsljud under match | – | – | `adult.amb.wind` (loop) | P4 | – | vuxen | förslag | Rekommenderas AV: batteri, och det maskerar trafikljud. |
| `match.head_start` | Fas `head_start` → `survival` | `engine.ts` (`phase`) | – | Inget ljud | – | – | – | tyst | `headStartS` är 0 i alla aktiviteter, så fasen byts direkt vid start. Ingen meningsfull händelse. |

## 3. Sammanfattning

- **35 rader inventerade.** 11 har ljud eller tal i minst en av apparna idag. 16 finns i koden men är tysta, och 4 av dem ska förbli tysta (`enemy.spawned`, `match.aborted`, `match.restored`, `match.head_start`). 6 är förslag på nya händelser. `extraction.closing` finns inte, och `voice.chain` är en del av röstuppspelningen.
- **Viktigaste luckorna** (finns, men är tysta): `enemy.contact` (infektionen börjar), `extraction.opened`, `match.won`/`match.time_up` (vuxen), `gps.lost_long`.
- **Mini** hörs idag bara vid checkpoint, plus talsyntes vid start, varning, fångad och vinst.
- **Talsyntes** (`speechSynthesis`) används för alla repliker idag. Den låter olika på varje telefon och saknas ibland helt (vissa Android-telefoner utan engelsk röst). Förinspelade filer ger samma röst överallt och fungerar offline.

## 4. Säkerhetsrisker (befintliga)

1. **"Run!"** vid zombiespurt (`SessionProvider.tsx:47`) uppmanar spelaren att springa, oavsett trafik. Nya repliker undviker ordet. Mini förbjuder det i valideringen (`MINI_FORBIDDEN` i `audio-production/lib.ts`).
2. **Jump scare** (`jump-scream.wav`, gain 1.0) är ett plötsligt starkt ljud vid gång i stadsmiljö. Det är avstängt på cykel men inte vid gång längs gata. Förslag i AUDIO-DESIGN §6: volym högst 0,85 och aldrig när en röst spelas. Själva funktionen ändras inte här.
3. **Ingen hörbar signal vid `infection_contact`.** Spelaren som inte tittar på skärmen vet inte att den håller på att bli fångad, och frestas att titta. Det är det starkaste argumentet för P0-ljudet.
4. **Upprepade larm** (detected + approaching + countdown + tension inom några sekunder) kan bli ett konstant flöde. Prioritetsmodellen i AUDIO-DESIGN §3 begränsar det.
