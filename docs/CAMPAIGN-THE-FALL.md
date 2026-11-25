# Kampanj: THE FALL

Kapitel 1 i storyn **REGENESIS** och det första spelbara kapitlet under CAMPAIGN. Fem uppdrag till fots, vart och ett en egen session som läggs ut runt den plats där spelaren startar.
Kampanjer är huvudprodukten; de tre fristående lägena ligger under FREE PLAY och är oförändrade.

Berättelsen (roller, tidslinje, kommande kapitel) styrs av den kanoniska Story Bible: [`OUTBREAK_STORY_BIBLE_V2_2.md`](OUTBREAK_STORY_BIBLE_V2_2.md).
Detta dokument beskriver den tekniska implementationen. Kampanjens text är **Story v1.1** (THE WAYSTATION i uppdrag 3, epilogens
fragment från evakueringsstyrkan).

## 1. Hur det hänger ihop

En motor, två ingångar. Kampanjen är **data och ett tunt lager ovanpå** samma motor som Free Play använder.

| Del | Fil | Ansvar |
|---|---|---|
| Uppdragsdefinitioner | `src/campaign/the-fall.ts`, `types.ts` | Deklarativt: basläge, layout, balans per svårighet, intro, mål, radiorepliker |
| Stories | `src/campaign/stories.ts` | `STORIES`: storyns titel och kapitelordning (Story → Chapter → Mission). Planerade kapitel är bara namn. Ett nytt spelbart kapitel = en definitionsfil (`CampaignDef`) och en post i sin story |
| Register | `src/campaign/index.ts` | `CAMPAIGNS`: alla spelbara kapitel i storyordning, härlett ur `STORIES`. Id:t (`the-fall`) styr sparade framsteg, URL:er och röstfiler och byts aldrig |
| Campaign Manager | `src/campaign/progress.ts` | Upplåsning, svårighet, sedda intron, resultat. Rena funktioner + localStorage |
| Regler och mål | `src/campaign/setup.ts` | `missionRules`, `missionObjectives`, `missionDurationS`, `missionParams` |
| Utläggning i terrängen | `src/campaign/prepare.ts` | `prepareMission`: banan (via Free Plays generator) eller destinationen |
| Story/Event | `src/campaign/story.ts` | `MissionStory`: spelhändelser → radiorepliker. Läser bara, ändrar aldrig spelet |
| Koppling | `src/play/rules.ts`, `match.ts`, `session.ts` | `MatchParams.campaign` markerar matchen; regler, mål och story läggs på |
| Ljud | `src/app/_client/audio.ts` | `story`-händelser: inspelad fil, ersättningsreplik eller signal + text |
| UI | `src/app/campaigns/`, `src/app/play/Play.tsx` | CAMPAIGN (`/campaigns`, storylistan) → story (`/campaigns/regenesis`, alla kapitel, kommande låsta) → kapitel (`/campaigns/the-fall`, uppdragen) → briefing, HUD, resultat |

Motorn fick fem **valfria** regler (`src/config/game-rules.ts`). Saknas de beter sig allt som förut, och
`scripts/regression-fingerprint.expected.txt` är oförändrad:

- `winOnTimeout` – att klockan går ut är vinsten (uppdrag 1).
- `intensity` – enkel Game Director: fartfaktor för zombierna i steg över speltiden (uppdrag 5).
- `interceptModel: "track"` – ny genskjutning, se avsnitt 4.
- `transmitSpawn` – extra infekterade när en signalöverföring börjar (uppdrag 4).
- `extractionRetry` – hittas ingen landningsplats görs nya försök var 15:e sekund.

Målmodellen (`src/engine/objectives/objectives.ts`) fick `anyOrder` (valfri ordning) och per mål `holdS`, `radiusM`, `keepProgress`.

## 2. De fem uppdragen

**Övergången 01 → 02 (2026-11-25):** uppdrag 1 har nu ett uttalat mål. Tidigt (25 %) berättar Watchtower att en grupp överlevare
gömmer sig i en källare i närheten och öppnar dörren när gatan är fri; vid 50 % "håll dem borta från källaren"; sista minuten "gatan
är nästan fri". När tiden gått öppnas källardörren och spelaren kommer in. Debriefen: elva främlingar, två sjuka, medicinen slut, och
Watchtower har ett uppdrag i gryningen. Uppdrag 2 börjar i källaren nästa morgon.

| # | Uppdrag | Basläge | Mål | Tid | Nytt för spelaren |
|---|---|---|---|---|---|
| 01 | FIRST CONTACT | Survival | Överlev 15 min tills överlevarna i källaren kan öppna dörren (vinst när tiden gått) | 15:00 fast | Karta, zombier, radio. 1–3 infekterade i början |
| 02 | THE SUPPLY RUN | Checkpoints | 3 platser i **valfri ordning**, ingen hemväg | från banan (≈ 30 min gräns, ≈ 20 min spel) | Vägval. Infekterade står vid platserna från start |
| 03 | NO WAY BACK | A to B | Automatiskt vald destination ≈ 1,5 km bort | från rutten | **Genskjutande** zombier |
| 04 | THE LAST SIGNAL | Checkpoints | 3 reläer i ordning, **signalöverföring** vid varje | från banan + överföringarna | Stanna i en zon medan hotet växer |
| 05 | FINAL EXTRACTION | Survival + extraction | Överlev 22 min, nå helikoptern inom 8 min | 30:00 fast | Allt ihop, stigande intensitet |

**Signalöverföring (04).** Zonen är 50–60 m i radie (aldrig snävare: GPS-brus, och spelaren ska kunna röra sig). Överföringen tar
20/30/30 s, sista reläet 30/45/45 s (Easy/Normal/Hard). Lämnar spelaren zonen **pausas** signalen och det som sänts ligger kvar;
den nollställs aldrig. Väl inne räknas spelaren som inne till 10 m utanför kanten, så GPS-brus vid kanten inte ger fladder.
Opålitlig GPS varken räknar eller tappar signalen. Varje påbörjad överföring drar 1–2 extra infekterade till området, alltid på
ordinarie säkert spawnavstånd (≥ 300 m).

## 3. Svårighet och balans

Svårigheten väljs i kampanjvyn (förval Normal), sparas med framstegen och kan ändras mellan uppdrag. Den påverkar aldrig
upplåsning, mål eller berättelse.

**Avvikelse, medveten:** kampanjen har en egen farttabell, `CAMPAIGN_SPEED_KMH = 3,6 / 5,6 / 6,6 km/h`. Easy och Normal är
Free Plays värden. Free Play Hard är 10,4 km/h, snabbare än en joggande spelare; med den farten vann simuleringsboten 0 av 20
i uppdrag 2–5 oavsett tempo. Hard i kampanjen får i stället sin svårighet av fler infekterade, större andel som genskjuter och
längre överföringar. Varje uppdrag skalar farten: 0,85 / 0,95 / 1,0 / 1,0 / 1,05.

Simulerade vinster av 20 per cell (fångad / tiden ute), `npx tsx scripts/campaign-balance.ts`:

```
mission | level | walk 4.7 km/h | brisk 6.1 km/h | jog 7.5 km/h | run 9.4 km/h   (wins of 20; caught / out of time)
01 FIRST CONTACT    | easy   | 20 (0/0) | 20 (0/0) | 20 (0/0) | 20 (0/0)
01 FIRST CONTACT    | normal | 19 (1/0) | 20 (0/0) | 20 (0/0) | 20 (0/0)
01 FIRST CONTACT    | hard   | 16 (4/0) | 17 (3/0) | 18 (2/0) | 18 (2/0)
02 THE SUPPLY RUN   | easy   | 20 (0/0) | 18 (2/0) | 19 (0/1) | 20 (0/0)
02 THE SUPPLY RUN   | normal |  0 (20/0) | 13 (5/2) | 18 (2/0) | 20 (0/0)
02 THE SUPPLY RUN   | hard   |  0 (20/0) |  0 (20/0) |  2 (11/7) | 14 (3/3)
03 NO WAY BACK      | easy   | 19 (1/0) | 17 (2/1) | 18 (1/1) | 16 (4/0)
03 NO WAY BACK      | normal |  0 (20/0) |  2 (15/3) | 14 (3/3) | 16 (4/0)
03 NO WAY BACK      | hard   |  0 (20/0) |  0 (20/0) |  1 (18/1) | 14 (6/0)
04 THE LAST SIGNAL  | easy   | 15 (2/3) | 18 (2/0) | 14 (6/0) | 19 (1/0)
04 THE LAST SIGNAL  | normal |  0 (20/0) |  1 (16/3) | 14 (3/3) | 19 (0/1)
04 THE LAST SIGNAL  | hard   |  0 (20/0) |  0 (20/0) |  1 (19/0) |  4 (12/4)
05 FINAL EXTRACTION | easy   | 15 (2/3) | 12 (5/3) | 12 (3/5) | 11 (3/6)
05 FINAL EXTRACTION | normal |  0 (20/0) |  0 (20/0) |  6 (14/0) |  8 (12/0)
05 FINAL EXTRACTION | hard   |  0 (20/0) |  0 (20/0) |  0 (20/0) |  4 (16/0)
```

Läs tabellen som en **jämförelse mellan uppdrag och nivåer**, inte som en prognos. Boten undviker närmaste zombie eller går
kortaste vägen mot målet; den planerar inte, lurar inga genskjutare och står dumt i zoner. Formen är den avsedda: Easy går att
klara gående, Normal kräver rask gång till jogg, Hard löpning. Hard i uppdrag 4 och 5 är det mest osäkra och ska fälttestas först.

## 4. Genskjutning (`interceptModel: "track"`)

Den befintliga genskjutningen var i praktiken avstängd i livespel: den stängs av när grafen har terrängkanter (vilket den har i
appen), och riktningen skattades mellan två observationer med 1 s mellanrum men krävde 8 m förflyttning. Den är orörd.

Den nya modellen är allmän zombie-AI bakom en regelflagga (`src/engine/ai/zombie-ai.ts`), i dag påslagen bara i kampanjen:

1. Motorn sparar spelarens snappade position var 4:e sekund, högst 8 st (≈ 30 s).
2. Riktningen läses mellan den senaste positionen och en som är minst 6 s äldre och 10 m bort. Står spelaren still finns ingen riktning.
3. Korsningar framför spelaren (bara riktiga stigar och vägar, inom ≈ 70° från färdriktningen och utan stor omväg) är kandidater.
4. Zombien väljer den tidigaste korsning den hinner till före spelaren, räknat med nominell gångfart, och går dit med A*.
5. Var 10–15:e sekund tittar den på spåret igen. Ligger korsningen inte längre framför spelaren ger den upp och följer efter.

Zombien vet alltså aldrig vart spelaren ska, bara vart spelaren har varit på väg. Andel som får genskjuta: 0 i uppdrag 1,
0/0/0,2 i 2, 0,25/0,45/0,65 i 3, 0/0,2/0,4 i 4 och 0,3/0,5/0,65 i 5.

## 5. Framsteg, misslyckande, avbrott

- Sparas i localStorage under `outbreak.campaign.the-fall`, direkt när matchen avgörs (inte först när historiken sparats).
- Vinst låser upp nästa uppdrag. Fångad eller tiden ute räknas bara som ett misslyckat försök. QUIT ändrar ingenting.
- Omspel av ett klarat uppdrag kan aldrig ta bort något; bästa tid sparas.
- Skadad eller manipulerad lagring kan aldrig låsa upp mer än vad som klarats i ordning.
- **QUIT**: uppdraget avslutas som avbrutet, spelaren hamnar i kampanjvyn. **Paus**: som i Free Play. **Appen i bakgrunden**:
  samma regler som Free Play (kort frånvaro simuleras i efterhand, lång pausar). **Appen stängd mitt i ett uppdrag**: det
  återställs pausat som samma uppdrag med samma regler; repliker vars ögonblick passerat sägs inte om.
- **GPS-bortfall**: klocka, zombier och berättelse står still. Uppdrag 1 kan alltså inte vinnas genom att tappa signalen.
- Privat läge utan localStorage: framstegen hålls i minnet så länge sidan lever, och resultatdialogen säger att det inte sparades.

## 6. Röstfiler (ElevenLabs)

Alla 50 repliker är inspelade (ElevenLabs, 2026-11-15) och visas dessutom som text. Ljudet väljs i tre steg: egen inspelning om den finns, annars en befintlig inspelad
replik (`fallbackVoice`, 13 repliker har en), annars en mjuk signal så spelaren vet att text kommit.

1. Manus: `docs/campaign/the-fall-voice-script.csv` – filnamn, talare, röstregi, utlösare, text. Genereras ur definitionerna.
2. Generera en MP3 per rad, döpt exakt som i kolumnen `file` (t.ex. `tf-m01-start.mp3`).
3. Lägg filerna i `public/campaign/the-fall/voice/`.
4. Kör `npm run campaign:voice` och checka in `src/campaign/voice-manifest.ts`. Spelet ber bara om filer som står där.

**Automatiskt med API:t** (i stället för steg 2–3): `npm run campaign:voice:generate` (`scripts/campaign-voice-generate.ts`) genererar
en torr tagning per replik till `assets/audio/campaign/the-fall/`, kör den genom en radiokedja med ffmpeg (telefonband, kompression,
squelch före och efter, −17 LUFS som övriga operatörsrepliker) och skriver spelfilen. Rösterna står som `elevenLabsVoiceId` på
talarna i `src/campaign/the-fall.ts` (WATCHTOWER = Kristen, RAVEN TWO = Morgan; det är ElevenLabs-rösternas namn, inte
karaktärernas. Karaktärerna har bara anropssignaler). Nyckeln läses ur `ELEVENLABS_API_KEY`; den står
aldrig i koden. Flaggor: `--dry-run`, `--only <id,id>`, `--force`, `--build` (bara radiokedjan, kostar inga tecken). Kör sedan steg 4.
Biblioteksröster via API kräver betalplan hos ElevenLabs.

Två röster: **WATCHTOWER** (44 repliker; civilförsvarets radiooperatör, lugn och exakt) och **RAVEN TWO** (6; helikopterpilot,
kort flygradio). Befintliga repliker har radioeffekten inbakad i filen; gör likadant, eller kör dem genom samma kedja som
`scripts/build-audio.mjs`. Replik-id:n är permanenta: byt aldrig namn på ett id som spelats in. CI kör `campaign:voice -- --check`.

### Berättarröst mellan uppdragen

En manlig berättare (ElevenLabs-rösten Damian, `Vep3bcB7LhKa3wfjMiI6`, sedan 2026-11-25; förut Brian, `narrator` i `src/campaign/the-fall.ts`) läser skärmarna mellan uppdragen högt. Ren röst,
ingen radioeffekt, aldrig under en match. Två läsningar per uppdrag, byggda ordagrant ur uppdragets text i `src/campaign/narration.ts`:

- **Briefing** (`tf-mNN-briefing`): uppdragets namn, introraderna och målet. Den separata intro-skärmen (bild, text, SKIP) är borttagen:
  före ett uppdrag finns en enda skärm, briefingen, och berättaren börjar läsa när den öppnas.
- **Debrief** (`tf-mNN-debrief`): vad vinsten ledde till (`success`), på resultatskärmen efter vinst. Den börjar när slutets egna ljud
  (dörr, helikopter, WATCHTOWERs sista replik) är klara. Efter kapitlets sista uppdrag läses även epilogen.

Flödet blir: vinst → resultatskärm (debrief läses) → NEXT → nästa uppdrags briefing (läses). Knappen LISTEN/STOP på båda skärmarna
läser igen eller tystar; att lämna skärmen eller trycka START MISSION stoppar läsningen. Musiken sänks under rösten. Med ljudet av läses
inget. Öppnas en briefing utan tryck (omladdning, bokmärke) tillåter webbläsaren inget ljud förrän spelaren trycker LISTEN.

Filer: tagningar i `assets/audio/campaign/the-fall/narration/`, spelfiler i `public/campaign/the-fall/narration/` (−18 LUFS, mjuk
kompressor), manus i `docs/campaign/the-fall-narration-script.csv`, lista i `RECORDED_NARRATION` (`npm run campaign:voice`). Samma
generator som radiorepliken: `npm run campaign:voice:generate -- --only tf-m01-briefing`. Ändras en text i `the-fall.ts` varnar
`campaign:voice` för att inspelningen inte längre stämmer med skärmen; generera då om den läsningen.

## 7. Bilder

Alla sex bilder i `public/campaign/the-fall/` är kampanjens egna originalbilder (inga platshållare):

| Fil | Motiv | Används |
|---|---|---|
| `cover.jpg` (1680×704) | Zombier på en gata i skymning | Kampanjkortet på startsidan, kampanjlistan, kampanjvyns huvud |
| `mission-01.jpg` (1086×1448) | Överlevare på villagata, solnedgång | FIRST CONTACT |
| `mission-02.jpg` (1086×1448) | Sjukvårdsförnödenheter och röd fackla vid skogsväg | THE SUPPLY RUN |
| `mission-03.jpg` (1086×1448) | Blockerad väg med övergivna fordon | NO WAY BACK |
| `mission-04.jpg` (1086×1448) | Radiomast med röda ljus i regn | THE LAST SIGNAL |
| `mission-05.jpg` (1024×1536) | Helikopter, facklor och zombier på ett fält | FINAL EXTRACTION |

Uppdragsbilderna är stående och visas som liggande remsa i uppdragskortet, som övre delen i briefingen och bakom resultatet i
uppdrag 1, 2 och 4. Vilken del som syns i de smala beskärningarna styrs av `imagePosition` i
`src/campaign/the-fall.ts`. Filerna är JPEG i full upplösning, kvalitet 86, progressiva.

## 8. Begränsningar

- Kartdata finns bara för Värmland. Utanför får spelaren samma besked som i Free Play. Berättelsen är platsoberoende, datan inte.
- Uppdrag 1 och 5 kräver minst 3 km sammanhängande nät (samma krav som Survival). Uppdrag 2 och 4 nöjer sig med två mål om nätet
  är litet. Uppdrag 3 söker destination i allt vidare avståndsband och avstår hellre än att lägga ett orimligt mål.
- Zonen i uppdrag 4 läggs på en korsning utan större väg, men spelet vet inget om belysning, sikt eller trafik på platsen.
- Rösterna är genererade och kontrollerade med taligenkänning mot manuset, men ingen människa har lyssnat igenom dem i spelet. Kampanjen är inte spelad i fält.
- Uppdrag 2 och 4 kan få två mål i glesa nät, medan radion säger tre: [`BUGG-THE-FALL-TVA-CHECKPOINTS.md`](BUGG-THE-FALL-TVA-CHECKPOINTS.md).

## 9. Fälttest

1. **Uppdrag 4 på riktig GPS**: håller zonen (55 m) under träd och mellan hus? Fladdrar paus/återupptagen? Är 30 s nervöst eller bara långt?
2. **Genskjutning**: märks den, går den att lura genom att byta väg, känns den orättvis i glesa nät med få korsningar?
3. **Hard, uppdrag 4 och 5**: går de att klara för en löpare?
4. **Uppdrag 2**: uppstår ett verkligt vägval, eller är ordningen alltid given? Hur ofta får uppdrag 2 och 4 bara två mål?
5. **Uppdrag 1**: lagom lugn inledning, eller händelselös på Easy?
6. **Uppdrag 5**: ligger landningsplatsen rimligt, räcker 8 min, känns slutet som en final?
7. **Radion**: hinner man läsa texten i rörelse, kommer replikerna för tätt, stör signalen?
8. **Tidsgränser i uppdrag 2–4**: de bygger på fågelvägen × 1,35 × marginal och är inte kalibrerade i fält.
9. **Avbrott**: lås skärmen mitt i en överföring, tappa GPS i en tunnel, stäng appen och öppna igen.

## 10. Tester

- `src/tests/unit/campaign-progress.test.ts` – definitioner, upplåsning, misslyckande, omspel, lagring.
- `campaign-story.test.ts` – vilken replik som sägs när, även efter återställning.
- `campaign-mechanics.test.ts` – valfri ordning, signalöverföring (GPS-fall), regler per svårighet, utläggning.
- `campaign-session.test.ts` – alla fem uppdrag genom sessionen på riktig Värmlandsdata, hela kampanjen i följd, fel/omspel, QUIT, återställning.
- `campaign-audio.test.ts` – radiorepliker i ljudlagret.
- `src/tests/simulation/campaign.test.ts` – genskjutning, motorregler, hela simulerade uppdrag.
- `e2e/campaign.e2e.mjs` – flödet i mobilstorlek i Chromium (`npm run e2e:campaign` mot en startad server).
