# Etapp 3 – spelbar GPS-version (3A kartdata/rutter, 3B GPS/motor/lagring, 3C testinstrument)

Status: implementerad och testad lokalt (simulerad GPS, mockad geolocation i headless Chromium). **Inget är fälttestat på riktig telefon.**

## Arkitektur
- Ren klientapp (Next.js, statiskt prerenderad, inga serverless-funktioner, ingen extern databas). Vercel = hosting av statiska filer.
- Motor, zombie-AI och ruttgenerering körs lokalt i webbläsaren. MapLibre ritar nätet (ingen bakgrundskarta/tile-server). Motorsteg kostar ca 0,03 ms med 15 zombier (mätt i Node) – ingen Web Worker behövs. Ruttgenerering tar 0,5–2,5 s på dator (begränsat sökdjup: `samples=100`, `maxCandidates=40`); på telefon förväntas flera gånger så lång tid – **ska mätas i fält**.
- `src/data` tiles → regionalt nät; `src/play` (config, prepare, match, LiveGame, session, storage, fieldlog); `src/gps/provider` (Geolocation); `src/app/{new,play,history,how-to-play,field}`.
- Borttaget: `/api/terrain` och `/api/validate-area` (Overpass vid körning). Biblioteksfilerna finns kvar för experiment.

## Kartdatapipeline (3A)
1. OSM-länsextrakt `varmland.osm.pbf` (openstreetmap.fr, md5 i manifestet).
2. `python3 -I experiments/data/build_tiles.py <pbf> public/data/v1/varmland --source <url> --md5 <md5>` (pyosmium): behåller hela stig-ways (path, footway, track, cycleway, service, residential, living_street, unclassified, pedestrian, bridleway) med vitlistade attribut; markerar noder som delas med större väg (≤ tertiary), järnväg eller å/bäck/älv (`h`).
3. Rutnät 0,05° × 0,1° (≈ 5,6 km), deltakodad JSON, mikrograder. Värmland: 786 tiles, 31,7 MB rått / 10,3 MB gzip. Manifest med `dataVersion` (innehållshash).
4. Leverans: statiska filer; tiles hämtas som `t/<ty>_<tx>.json?v=<dataVersion>` (immutable), manifestet revalideras. Klienten laddar bara tiles som täcker matchradien (Mission/Escape ≈ 0,5–0,75 × sträcka + marginal; ex. 3 km promenad = 4 tiles ≈ 0,7 MB) och cachar dem i IndexedDB (rensas när `dataVersion` byts).
5. Klienten: `decideWay` per aktivitet → delning vid hazard-noder (varje del får egen ändnod; nätet förbinder aldrig två sidor av en väg/järnväg/vatten) → klipp till radien → komponenten närmast start (≥ 1,5 km) → `generateRoutes`.

Konservativa regler (`decideWay`, saknade attribut ≠ tillåtet): explicit förbud/begränsning (`access` private/no/customers/permit/delivery/military/forestry/agricultural, `foot`/`bicycle` no/dismount/use_sidepath) utesluts om inte tillåtande tagg finns; vadställen (`ford`), dålig stigsynlighet, `sac_scale` ≥ mountain_hiking, cykelbana utan `foot=yes/designated` (Walk/Run), gångväg utan `bicycle=yes/designated` (MTB), `mtb:scale` ≥ 3, byggen, trappor, p-gångar. Enkelriktade MTB-stigar behåller riktning. Förslag med större-väg/järnvägs-"korsningar" visas bara om inget annat finns. Start >150 m från nät, utanför Värmland, för lite sammanhängande stig, orimlig sträcka eller ingen acceptabel rutt ger ett förklarande avslag; avvikelse >10 % erbjuds som "närmaste alternativ".

## GPS (3B)
- `watchPosition` (high accuracy, maximumAge 0) → `GpsFilter` (ogiltigt/gammalt/hopp avvisas, Kalman) → `LiveGame` → samma `stepGame` som simuleringarna.
- Färskhet: >2,5 s sedan senaste godkända fix ⇒ infektion pausad (kortare än infektionstiden, så en enda fix kan aldrig ensam infektera); >5 s ⇒ GPS otillgänglig, klocka och zombier står stilla; >60 s ⇒ `gps_lost_long` (UI erbjuder avslut). Fruset tick (>5 s) ⇒ paus, ingen tid tas igen.
- Mål/extraction: radie 30 m, 5 s, endast `ok`/`verify` (oförändrat). **Nytt:** minst 3 olika fixar under bekräftelsen, och vid `verify` krymper radien med (noggrannhet − 10 m). Hoppande enstaka fixar avvisas av filtret. Värdena är preliminära och **ändrades inte utifrån simuleringar**; de ska verifieras i fält (se protokollet).
- Spelaren får lämna rutten; ingen tid straffas vid paus/stopp. Spelet startar och återupptas alltid manuellt, med 5 s neutral period mot smitta efter paus.
- Positioner utanför nätet används oförändrat för infektion (zombier är stigbundna); AI läser aldrig mål/extraction (testas statiskt). Zombier syns på kartan inom 150/250/400 m (Walk/Run/MTB) – UI-värde att justera.
- Bakgrundskörning (sökning, **ej verifierat på enhet**): webbläsare ger ingen garanti för GPS/timers med låst skärm eller i bakgrunden. iOS Safari och iOS-PWA: Wake Lock stöds från iOS 16.4 i Safari, i installerade PWA:er först efter en fix i iOS 18.4 enligt källor; `watchPosition` kan sluta leverera med skärmen släckt. Android Chrome/PWA: Wake Lock stöds, släpps när sidan döljs; bakgrunds-GPS ej garanterad. Konsekvens: appen **måste vara i förgrunden**; vid `visibilitychange`/`pagehide` pausas spelet, Wake Lock begärs om vid fortsättning, och ingen smitta registreras från gissad position. Källor: [WebKit 254545](https://webkit.org/b/254545), [caniuse Wake Lock](https://caniuse.com/wake-lock), [Chrome Wake Lock](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock).

## Lokal lagring (3B)
IndexedDB `outbreak` v1: `tiles`, `matches` (tillstånd + graf), `history`, `logs`, `meta`. Ögonblicksbild vid händelser (mål, fas, smittkontakt, paus/fortsätt) och var 10:e sekund. Motorns `GameState` är ren JSON (RNG, zombier/AI, mål). Vid omladdning återställs matchen **pausad**, filtret är tomt och spelet kräver färsk fix. Ny `SNAPSHOT_SCHEMA`/`RULES_VERSION`, skadat tillstånd eller zombie på okänd kant ⇒ avslutas kontrollerat som "interrupted". Avslutad match behåller bara en lätt historikpost (datum, läge, aktivitet, svårighet, planerad och uppmätt sträcka, matchtid, resultat, mål). Radering per match eller allt. Ingen inloggning.

## Testinstrument (3C) – `/field`
Logg per match (lokal, IndexedDB): GPS-fixar/avvisade (ogiltig/gammal/hopp), medel/max-noggrannhet, bortfall och längsta bortfall, app-frysningar, ruttens längd, uppmätt sträcka, rutt-genereringstid, tile-statistik, mål, smittkontakter, matchtid, resultat, aktivitet/svårighet, kartfel. GPS-spår sparas bara om det slås på (av som standard). Export till fil på knapptryck, ingen telemetri. Batteri: Battery API där det finns, annars manuell avläsning före/efter.

## PWA och Vercel
- `manifest.webmanifest` ("OUTBREAK – Solo Survival", ikoner 192/512/maskable, standalone, portrait), `sw.js` (statiska filer + nätverk-först för sidor; **ingen offline-garanti**; kartdata cachas av appen i IndexedDB). Ny version väntar tills spelaren trycker Uppdatera (aldrig under match); `/version.json` (commit-SHA) jämförs med inbyggt bygg-id.
- `vercel.json` (framework nextjs, `npm ci`, `npm run build`), cache-headers i `next.config.mjs`, Permissions-Policy `geolocation=(self)`. HTTPS krävs för GPS (Vercel ger det). Direktlänkar/omladdning fungerar (statiska routes).
- Bygg-id = `VERCEL_GIT_COMMIT_SHA`: kontrollera mot `https://<domän>/version.json` att rätt commit är driftsatt.

## Kända begränsningar
- Ingen fältverifiering (GPS-brus under skog, verify-gränsen, 30 m/5 s, bakgrundsbeteende, batteri, genereringstid på telefon).
- OSM-data är ofullständig; attribut kan saknas eller vara fel. En genererad rutt är aldrig en säkerhetsgaranti. Vägar utan delad nod (broar, tunnlar) antas korrekt hanterade; sjöar/ytvatten utan ledning ses bara som återvändsgränder. Militära områden/naturreservat utan tagg på själva stigen fångas inte.
- Tidsgränsen (befintlig definition från 2.5) blir generös: 3 km promenad ≈ 1 h 27 min.
- Kartan visar bara stignät (ingen bakgrundskarta).
- Inga tester på riktig iPhone/Android har gjorts; WebKit finns inte i utvecklingsmiljön.

## Fältprotokoll (minimum)
1. Installera/öppna på enheten via HTTPS. `/field`: starta GPS, notera noggrannhet öppet/skog, Wake Lock-stöd, batteri %.
2. Kör 3 pass per aktivitet (Walk 3 km, Run 5 km, MTB 10 km) i Värmland, minst ett i tät skog. Låt skärmen vara på; prova medvetet en gång lås/byte av app och notera beteende.
3. Mäta: avvikelse planerad vs uppmätt sträcka; antal/längd GPS-bortfall; om mål registrerades för tidigt/sent (stå 20, 30, 40 m från ett mål); falska smittor vid dålig GPS; rutt-genereringstid; batteri/timme; rendering/kartfel.
4. Export logg (`/field`) och sammanfatta per enhet. Justera `verify`-marginal, antal fixar, färskhetsgräns och synlighetsradie först efter dessa data.
5. Säkerhet: gör aldrig fälttest i trafik eller på cykel med blicken på skärmen; abort alltid tillåtet.

## Kommandon
`npm test` (155 tester), `npm run typecheck`, `npm run build`, `npm run e2e` (kräver `npx next start -p 3100`; mockad GPS), `npm run tiles -- <pbf> <utkatalog>`.
