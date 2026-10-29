# Ljuddesign och integrationsplan – Outbreak och Mini Outbreak

Specifikation för hur förinspelade ElevenLabs-ljud ska låta, prioriteras och spelas i båda apparna. **Ingenting i appen är ändrat ännu.**
Det här är planen för en separat integrations-PR efter att manus, röster och provpaket har godkänts.

Relaterat: [AUDIO-INVENTORY.md](AUDIO-INVENTORY.md) (händelser och nuläge) · [AUDIO-SCRIPTS.md](AUDIO-SCRIPTS.md) (manus) ·
[ELEVENLABS-WORKFLOW.md](ELEVENLABS-WORKFLOW.md) (produktion och kostnad) · `audio-production/catalog.json` (maskinläsbar källa).

## 1. Principer

1. **Information före atmosfär.** Ljud ska låta spelaren hålla blicken på omgivningen. Varje varning som spelet visar på skärmen och som påverkar utfallet ska också höras.
2. **En röst åt gången.** Två repliker spelas aldrig samtidigt. Den viktigaste vinner. Gammal information tappas hellre än köas.
3. **Kort.** Repliker under ca 3 s, effekter under 3 s. Ingen monolog.
4. **Statiska filer.** Allt ligger i `public/audio/el/` respektive `apps/mini/public/audio/el/`. Ingen nyckel, inget API-anrop och ingen backend under spel.
5. **Samma motor.** `src/audio/cue-player.ts` byggs ut. Apparna skiljer sig bara i sitt ljudpaket (`SoundPack`), precis som idag.
6. **Talsyntes som reserv.** Om en fil saknas, inte hunnit avkodas eller inte kan spelas används dagens `speechSynthesis`-replik. Ett trasigt ljud får aldrig ge tystnad där det idag finns ljud.

## 2. Ljudprofiler

### Outbreak (vuxen)

- **Röst (`adult-operator`):** operatör på radio som guidar en ensam överlevare. Tydlig, kontrollerad och lite raspig. Höjer tonen bara vid P0.
- **Radiokedja:** `adult.sfx.radio_in` (klick/brus, 0,3–0,5 s) → replik → `adult.sfx.radio_out`. Radiofiltret (bandpass) läggs på i appen så att originalet förblir rent.
- **Fiender:** närliggande morranden (första kontakt), avlägsna skrik (atmosfär), spurtskrik, attack vid fångst.
- **Effekter:** varningssignal (P0), tydlig bekräftelse vid checkpoint, helikopter vid extraction och vinst, dov smäll och brus vid förlust, spänningsdrön vid närhet.
- **Atmosfär:** valfri vindloop, rekommenderas **av** som standard.

### Mini Outbreak (barn)

- **Röst (`mini-narrator`):** vänlig berättare med tydligt uttal och positiv energi. Tilltalar spelaren som "explorer".
- **Fiender:** egen karaktär per typ. *Cute Zombie:* små komiska morranden. *Rainbow Ghost:* luftiga "woooo" med glitter. *Rainbow Spider:* snabba glada kvitter. *Mini Monster:* bubbliga läten.
- **Effekter:** mjuk marimbavarning, glad klang vid checkpoint, kort fanfar vid vinst, "boing" med glidflöjt vid förlust, leksakshelikopter vid extraction.
- **Aldrig:** skrik, jump scares, plötsliga starka ljud, förlust som låter sorglig, ordet "run". Valideringen i `audio-production/lib.ts` stoppar förbjudna ord i Minis repliker och skrämmande ord i Minis effektbeskrivningar.

## 3. Prioritet och mixning

| Prio | Innehåll | Exempel |
| --- | --- | --- |
| P0 | Kritisk spelinformation och säkerhet | infektion börjar (`enemy.contact`), avståndsnedräkning, cykel `offnet.exposed` |
| P1 | Extraction, vinst, förlust, GPS | `extraction.opened`, `match.won`, `match.captured`, `match.time_up`, `gps.lost_long` |
| P2 | Fiendevarningar | `enemy.approach`, `enemy.first_contact`, `enemy.sprint`, `enemy.detected` |
| P3 | Bekräftelser | checkpoint, paus/fortsätt |
| P4 | Atmosfär och fiendeläten | avlägsna skrik, spänningsdrön, jump scare, ambient |

**Kanaler.** Röstkanalen spelar en replik i taget. Effektkanalen spelar högst två ljud samtidigt; det äldsta P4-ljudet stoppas om ett tredje kommer.

**Regler för röstkanalen** (fältet `interrupts` i katalogen):

1. En ny replik med **högre** prioritet avbryter pågående replik (snabb uttoning ca 80 ms). Den avbrutna repliken spelas inte om.
2. `same-or-lower` (bara nedräkningen) avbryter även samma prioritet: "Twenty!" ersätter "Thirty." som inte hunnit klart.
3. En replik med **samma eller lägre** prioritet köas. Kön rymmer **en** replik. Den tas bort om den väntat mer än 3 s (P0–P2) eller 5 s (P3). P4 köas aldrig.
4. Minst 0,4 s mellan två repliker.
5. Cooldown gäller per ljud-id (katalogens `cooldownS`). Dessutom: `enemy.detected` aldrig inom 10 s efter `enemy.approach`, och tvärtom.
6. Under en replik sänks effektkanalen till ca 40 % (ducking). Jump scare och P4 startar aldrig under en replik.

**Händelse → ljudsekvens** (sekvenser spelas i ordning; effekten går på effektkanalen och repliken startar när effekten är halvvägs):

| Händelse | Outbreak | Mini |
| --- | --- | --- |
| `match.start` | radio_in → `vo.game_start` | `sfx.game_start` → `vo.game_start` |
| `enemy.first_contact` | `enemy.growl` → `vo.first_contact` | `vo.first_contact` (+ typens läte) |
| `enemy.approach` | `vo.enemy_nearby` | `sfx.warning` → `vo.enemy_nearby` (eller `vo.nearby_kind`) |
| `enemy.contact` | `sfx.warning` → `vo.danger_close` | `sfx.warning` → `vo.danger_close` |
| `objective.checkpoint` | `sfx.checkpoint` → `vo.checkpoint` | `sfx.checkpoint` → `vo.checkpoint` |
| `extraction.opened` | `sfx.extraction_open` → `vo.extraction_open` | `sfx.extraction_open` → `vo.extraction_open` |
| `match.won` | `sfx.victory` → `vo.victory`/`vo.extracted` | `sfx.victory` → `vo.victory` |
| `match.captured` | `enemy.capture` → `vo.captured` (700 ms) | `sfx.caught` → `vo.caught` |
| `match.time_up` | `sfx.game_over` → `vo.time_up` | `vo.time_up` |

**Variation.** När `random` = ja väljs en slumpvis variant, men aldrig samma som förra gången för samma ljud-id.

**Nivåer.** Katalogens `volume` är förstärkningen i appen (0–1). Filerna normaliseras före godkännande: tal ca −16 LUFS,
effekter ca −18 LUFS och atmosfär ca −28 LUFS, med topp högst −1 dBTP. Då betyder samma `volume` samma upplevda nivå.

## 4. Arkitektur (föreslagen utbyggnad, ej implementerad)

```
audio-production/catalog.json ──(generate.ts --approve)──▶ public/audio/el/**.mp3, apps/mini/public/audio/el/**.mp3
                │
                └─(nytt kommando: --emit-pack)──▶ src/audio/packs/adult.generated.ts, apps/mini/src/client/pack.generated.ts
                                                     (bara godkända filer: id, url[], prio, cooldown, volym, interrupts, random)

PlaySession.onCue(cue, text) ─┐
Play.tsx (approach, countdown,├──▶ eventToSounds(event) ──▶ CuePlayer (src/audio/cue-player.ts)
 captured, start, pause …)   ─┘                                ├─ röstkanal: kö, prioritet, avbrott, ducking
                                                               ├─ effektkanal: max 2
                                                               └─ reserv: speechSynthesis / syntetisk ton / vibration
```

Ändringar i integrations-PR:en:

1. **`SoundPack` får `clips`:** `Record<SoundId, { urls: string[]; priority; cooldownS; volume; interrupts; random }>`, plus `events: Record<EventId, SoundId[]>`. Dagens `samples`/`audible`/`patterns` finns kvar, så att utan godkända filer låter det exakt som idag.
2. **`CuePlayer.play(event)`** med reglerna i §3. `speak()` och `playCue()` finns kvar som reserv och för bakåtkompatibilitet.
3. **Händelser:** `PlaySession.endMatch` skickar redan `extraction_opened`, `infection_contact`, `gps_lost_long`, `off_network` och `finished` via `onCue`. Det som saknas: `result` vid `end` (vinst eller tid slut; finns i `MatchView.result`), `extraction_unavailable`, `off_network: left`, samt pause/resume från knapparna. Det är rena tillägg i klientkoden. Spelregler, motor, AI och GPS ändras inte.
4. **Inläsning:** se §5.3. Avkoda kritiska ljud direkt och resten vid behov.
5. **Inställningar:** dagens av/på (`outbreak.cues`, `mini-outbreak.cues`) styr allt. Förslag för senare: separat reglage för "röst" och "atmosfär".
6. **Tester:** enhetstester för kö, prioritet, cooldown och variantval med fejkad klocka och fejkad `AudioContext`, i samma stil som `src/tests/unit/countdown.test.ts`.

**Förslag på nya händelser** (implementeras inte utan godkännande; markerade `proposed` i katalogen):
`extraction.soon` (1 min före), `extraction.holding` (i zonen), `time.warning` (5 min / 1 min kvar), `gps.restored`,
`enemy.reveal` (avlägset skrik när zombierna får spelarens position), Minis typspecifika varning (`mini.vo.nearby_kind` och fiendeläten efter `enemyKind`), samt vindloop.
Alla kan beräknas i klienten ur befintligt tillstånd (`elapsedS`, `limitS`, `rules.extractionOpensAtS`, `extractionHoldS`, `gpsLost`, `zombiesNear[0].id`), utom `reveal`, som kräver att `session.ts` släpper igenom motorns befintliga händelse.

## 5. Plattformar: mobilwebbläsare

Det här bygger på hur Web Audio, talsyntes och PWA:er beter sig på iOS Safari och Android Chrome i allmänhet, och på hur koden
redan hanterar dem. **Inget av det har fälttestats med de nya filerna.** Särskilt gäller: **lova inte att ljud hörs med låst skärm eller med appen i bakgrunden.**

### 5.1 Användarinteraktion

- Både `AudioContext` och `speechSynthesis` kräver en gest. Dagens `unlockAudio()` körs på START/CONTINUE och på knapparna i NewGame. Varje senare tryck (`pointerdown`) väcker kontexten igen. Det behålls.
- Efter omladdning eller återställd match är ljudet låst tills spelaren trycker CONTINUE. Inga ljud förväntas före det.

### 5.2 Låst skärm, bakgrund och återkomst

| Situation | iOS Safari / PWA | Android Chrome / PWA | Hur appen hanterar det |
| --- | --- | --- | --- |
| Skärmen släcks eller låses | Sidan stoppas i praktiken. `AudioContext` pausas ("interrupted"/"suspended"), timers och GPS-bevakning stannar. **Inga ljud.** | Timers stryps hårt. GPS i bakgrunden levereras normalt inte till en webbsida. **Räkna inte med ljud.** | Wake lock (`navigator.wakeLock`) håller skärmen tänd under spel. Det är den egentliga lösningen. Bakgrund > 45 s (`BACKGROUND_GRACE_MS`) pausar matchen. |
| Annan app i förgrunden | Samma som ovan. | Samma som ovan. | `session.onVisibility` simulerar frånvaron vid återkomst eller pausar. |
| Återkomst | Kontexten kan vara "interrupted" tills nästa gest. Första ljudet kan utebli. | Återupptas oftast utan gest. | `wake()` försöker `resume()` före varje ljud. `pointerdown`-kroken väcker vid första tryck. Händelser som inträffade under frånvaron spelas **inte** upp i efterhand (gammal information); bara `app.paused_away` när sidan syns igen. |
| Telefonsamtal, Siri, annan app spelar ljud | Kontexten avbryts. | Ljudfokus kan tas. | Som ovan. Kön töms vid avbrott. |
| Ljudlös-knappen (iPhone) | Web Audio tystas av ljudlös-knappen. Om talsyntesen också tystas är **okänt**: testa. Safari 17+ har `navigator.audioSession.type = "playback"`, som kan spela trots ljudlös men pausar annan musik. | – | **Att utreda i fälttest.** Ett tydligt besked på startsidan ("stäng av ljudlöst läge") kan behövas. |
| Musik/podd i bakgrunden | Web Audio mixas normalt med annan musik. Talsyntesen kan sänka den. | Liknande. | Ingen ändring. Ducking av andra appar kan inte styras från webben. |
| Vibration | Saknas på iPhone. | Fungerar. | Behålls som komplement, inte som ersättning. |

### 5.3 Flera ljud samtidigt, minne och batteri

- **Samtidighet:** reglerna i §3. Utan dem kan första kontakt, varning, nedräkning och spänningsdrön hamna inom samma sekund.
- **Nedladdning:** cirka 2,6 MB (vuxen, alla 72 filer) och 1,8 MB (Mini, 55 filer) i mp3 128 kbit/s. Mono 64 kbit/s halverar det, vilket räcker för röst och de flesta effekter.
- **Minne:** avkodat ljud är okomprimerat (48 kHz × 4 byte per kanal och sekund). Allt avkodat samtidigt blir cirka **32 MB** (vuxen) eller **22 MB** (Mini) i mono, och det dubbla i stereo. Det är för mycket för äldre telefoner bredvid kartan. Därför:
  - konvertera alla filer till **mono** före godkännande (positionering behövs inte);
  - avkoda direkt bara **P0–P2-ljud för befintliga händelser** (ca 19 MB vuxen / 13 MB Mini) — eller ännu hellre bara en variant per ljud-id i förväg och resten vid första användning;
  - avkoda slutljud (vinst, förlust) först när matchen närmar sig slutet eller när de behövs. Fördröjningen är under 100 ms för korta filer;
  - släpp buffertar efter matchen (`reset`).
- **Batteri:** ingen kontinuerlig ljudström. Kontexten kan stängas (`suspend`) när inget spelats på en stund och väckas inför nästa ljud; `wake()` gör det redan. Vindloopen är det enda kontinuerliga ljudet och är därför av som standard.

### 5.4 Offline

- Service workern cachar `/audio/*` först när filen hämtas. `preloadCues()` hämtar paketets filer efter första tryckningen, alltså **under** första matchen, och utan nät missas de.
- **Förslag:** förhämta paketets filer på förhandsvisningssidan (före START, när nätet oftast finns), och lägg till en versionerad förcachelista i `sw.js` (`STATIC`-cachen) för P0–P2. Sökvägen `/audio/el/` matchar redan `isStatic` i båda service workers.
- Ändrade filer får nytt filnamn eller ny version i URL:en (`?v=<sha8>` från manifestet), så att den gamla cachen inte används.

## 6. Säkerhet

1. **Ingen replik kräver att man tittar på skärmen.** Avstånd sägs i ord; "kolla kartan" används aldrig.
2. **Inga uppmaningar att springa.** Nya repliker undviker *run* (dagens talade "Run!" ersätts). Mini förbjuder ordet i valideringen.
3. **Volymtak:** effekter, fiendeläten och atmosfär har högst `volume` 0,9 (valideras). Bara repliker får 1,0, eftersom de ska höras. Jump scare är begränsad till 0,85, avbryter aldrig tal, och planeras redan bara vid gång (aldrig cykel, aldrig Mini). Att stänga av jump scares vid gång längs bilväg vore säkrast, men det är en ändring av spelupplevelsen och föreslås bara här.
4. **Ljud ersätter inte trafikljud.** Rekommendera en hörlur eller transparensläge i *How to play*. Det är ett förslag och inte ändrat.
5. **Ingen information bara i ljud.** Allt som sägs syns också i HUD:en (redan så idag), så att en spelare utan ljud inte missar något.
6. **Mini:** inga skrik, inga plötsliga starka ljud, förlust låter lekfull. Fiendelätenas volym (0,55–0,6) ligger under rösten.

## 7. Fälttest före lansering

Med provpaketet integrerat i en testbuild, på minst en iPhone (Safari och hemskärms-PWA) och en Android (Chrome):

1. Hörs START-repliken direkt efter tryck? Med ljudlös-knappen på? Med musik igång?
2. Skärmen släcks av misstag i 10 s, 60 s: vad hörs vid återkomst, och krävs ett tryck?
3. Fem händelser inom 3 s (simulera med `/dev`): hörs bara den viktigaste, och tappas de gamla?
4. Utomhus i trafikmiljö: går repliker och varningssignal att uppfatta i högtalaren i fickan och i en hörlur?
5. Minnesanvändning efter 30 min (Safari Web Inspector / Chrome remote debugging).
6. Mini med barn: uppfattas fiendelätena som roliga och inte som obehagliga?
