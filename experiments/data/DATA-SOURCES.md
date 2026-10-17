# Svenska kartdatakällor för OUTBREAK (etapp 2.5, del A)

Datum: 2026-10-17. Status: **OSM är mätt på verkliga data. Lantmäteriets stigdata (Topografi 10/50) kunde inte hämtas härifrån** (kräver Geotorget-konto/inloggning), så jämförelsen OSM mot Lantmäteriet är *dokumentbaserad*, inte uppmätt. Verktyg för den mätta jämförelsen är byggda och testade (se "Beställning" nedan).

## Sammanfattande rekommendation

1. **OSM som enda ruttkälla i v1**, hämtad som **regionalt länsextrakt** (inte Overpass).
2. **Lantmäteriets Topografi 10 som valfritt komplement senare**, först efter att den uppmätta jämförelsen gjorts och licensvillkoren (annat än CC0) lästs. Topografi 50 är **inte** lämplig för stigrouting.
3. **Slå aldrig samman automatiskt.** Regler för en korrekt kombination står i avsnitt 5.

## 1. Vad som kontrollerats och vad som fungerade

| Källa | Nåbar härifrån? | Vad jag kunde verifiera |
|---|---|---|
| Geotorgets dokumentation (T50, T10) | Ja | Innehåll, villkor, leveranssätt, attribut |
| Geotorget Nedladdning / `dl1.lantmateriet.se` | **Nej: HTTP 401 (Basic auth)** | Data kräver beställning/inloggning |
| Lantmäteriets öppna STAC-API (`api.lantmateriet.se/stac-vektor/v1`) | Ja (metadata) | Samlingar: ortnamn, byggnader, fastighetsindelning, marktäcke, belägenhetsadresser, kommun-län-rike. **Topografi 10/50 ingår inte.** Filerna kräver samma inloggning (401) |
| Geofabrik (`download.geofabrik.de`) | **Nej (blockerad i sandlådan)** | Förväntas fungera i produktion |
| `download.openstreetmap.fr/extracts/europe/sweden/` | **Ja** | Dagliga länsextrakt (Värmland 39 MB, md5 verifierad, tidsstämpel 2026-10-17 01:26 UTC) |
| Skogsstyrelsens geodatasida | Nej (HTTP 403 mot automatisk hämtning) | Bara via sökning: lutning, markfuktighet och terrängskuggning finns som raster |
| Overpass-API:er | Nej (nio instanser: blockerade, trasiga, vitlistade eller regionala) | Se hybridstudien |

## 2. Lantmäteriet

### Topografi 50 Nedladdning, vektor (dokumentation 2026.05)

- **Villkor:** avgiftsfri, **CC0**. Beställs i Geotorget (engångsuttag eller abonnemang, API eller manuellt). Urval: Sverige eller län. Format: **GeoPackage** (en fil per tema, t.ex. `kommunikation_ln17.gpkg`, skikt t.ex. `ovrig_vag`). Koordinatsystem SWEREF 99 TM (valbart även lokala zoner). Uppdateras veckovis.
- **Härkomst:** *automatiskt generaliserad* ur Topografi 10 för skala 1:15 000–1:50 000.
- **Stigar:** objekttyperna Parkväg, Cykelväg, Gångstig, Elljusspår, Traktorväg och Vandringsled (skiktet `ovrig_vag`) samt Väglinje (NVDB). **Gångstig redovisas bara om den leder till bebyggelse (≥ 100 m), annat specifikt mål (≥ 250 m), sammanbinder vägar eller går längs strand.** Dessutom "viss redigering" i stigtäta områden.
- **Attribut:** `objekttyp`, `vagutforande` (**bro / tunnel / underfart / normal**), `skoterkorning_tillaten`. **Inga tillträdes- eller cykelattribut.**
- **Bedömning:** generaliseringen tar bort exakt det vi vill ha (små skogsstigar och MTB-stråk). **Inte lämplig som ruttkälla.** (Dokumentbaserad slutsats, ej mätt.)

### Topografi 10 Nedladdning, vektor (dokumentation 2026.05)

- **Villkor:** avgiftsfri sedan 2025-02, men **inte CC0**: "användningsvillkor för värdefulla datamängder som innehåller personuppgifter" (PDF hos Lantmäteriet). Måste läsas av jurist/ansvarig innan integration. Urval: Sverige, län eller **kommun**. GeoPackage, endast SWEREF 99 TM.
- **Innehåll:** samma objekttyper i `ovrig_vag` men **ogeneraliserade** (grunddata), plus `vaglinje` från Trafikverkets NVDB med bl.a. Småväg enkel standard (skogsbilvägar), Kvartersväg, Lokalgata liten. `vagutforande` anger bro/tunnel/underfart.
- **Kvalitet (dokumentation):** Övrig väg är flygbildstolkad; krav på lägesosäkerhet Cykelväg/Parkväg 2 m, **Gångstig 10 m**, Elljusspår/Traktorväg 5 m, Vandringsled 10 m. "Klassificeringen av cykelvägar kan skilja sig något från Trafikverket."
- **Attribut:** som T50. **Inga tillträdes- eller cykeltillåtelseattribut**, så OSM:s `bicycle=*`, `access=*` och `mtb:scale` har inget motsvarande.
- **Bedömning:** potentiellt användbar som komplement (bro/tunnel-flaggor, andra stigar, kontrollkälla), men **otestad** och licensen ska granskas.

### Öppna Lantmäteridata som skulle hjälpa hinderfrågan

Marktäcke (kommunindelad GeoPackage, CC BY 4.0, Karlstad 25,9 MB) och Byggnader (8,7 MB) listas i det öppna STAC-API:et. Nedladdningen kräver dock inloggning (401). De skulle ge vatten och byggnader med bättre täckning än OSM. Ej mätt.

## 3. OpenStreetMap och regionala extrakt

**Mätt.** Extraktet `varmland.osm.pbf` (39 MB, 2,5 s nedladdning, md5 verifierad) bearbetades med `experiments/data/extract_pbf.py` (pyosmium): hela länet scannades på **25,7 s** (101 756 relevanta ways) och de tre rutorna plockades ut.

**Resultat: identiskt med de OSM-API-tiles som användes i hybridstudien.** Samma ways, kanter, korsningar och komponenter i alla sex område/aktivitet-kombinationer; geometrisk täckning 100,00 % åt båda hållen inom 10 m (`results-compare-osm.txt`). Ett regionalt extrakt kan alltså ersätta både Overpass och API-tiling utan kvalitetsförlust, och löser problemet med ofullständiga multipolygon-relationer (Vänern).

Rekommenderad produktionsväg: veckovis/daglig hämtning av länsextrakt (Geofabrik eller motsvarande) → serversida extraktion till graf per område → cache hos Vercel och IndexedDB. Overpass ska inte vara kritisk väg (nio av nio publika instanser var otillgängliga vid hämtningen).

### Uppmätta OSM-nyckeltal per område (alla komponenter, produktionens filter)

| Område | Akt. | Längd | Kanter | Korsn. | Komp. | Största komp. | Återvändsgrenar |
|---|---|--:|--:|--:|--:|--:|--:|
| Skutberget | löpning | 40,6 km | 346 | 168 | 10 | 87,3 % | 28,6 % |
| Skutberget | MTB | 37,9 km | 304 | 142 | 11 | 86,2 % | 33,1 % |
| I2-skogen | löpning | 92,0 km | 1 014 | 538 | 6 | 95,2 % | 17,7 % |
| I2-skogen | MTB | 89,1 km | 936 | 496 | 6 | 95,1 % | 19,6 % |
| Sörmon | löpning | 65,1 km | 486 | 257 | 3 | 98,9 % | 12,6 % |
| Sörmon | MTB | 62,2 km | 446 | 227 | 3 | 98,9 % | 15,0 % |

### Attributtäckning i OSM (andel av ways | andel av längd)

| Område | access | foot | bicycle | mtb:scale | surface | oneway | bridge | tracktype |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Skutberget | 1 \| 0 | 10 \| 14 | 18 \| 28 | 25 \| 37 | 51 \| 61 | 15 \| 16 | 2 \| 0 | 11 \| 16 |
| I2-skogen | 0 \| 0 | 5 \| 10 | 4 \| 9 | 46 \| 49 | 32 \| 51 | 1 \| 1 | 0 \| 0 | 5 \| 13 |
| Sörmon | 1 \| 0 | 6 \| 6 | 13 \| 16 | 60 \| 65 | 43 \| 52 | 10 \| 12 | 1 \| 0 | 13 \| 16 |

### Användbarhet för säker ruttgenerering (största komponenten, % av längd)

| Område | Akt. | I största komp. | Uttryckligt positivt tillträdesstöd | Enkelriktat | Korsningar med större väg |
|---|---|--:|--:|--:|--:|
| Skutberget | löpning | 87,3 % | 17,7 % (`foot=yes/designated`) | 5,1 % | 24 noder |
| Skutberget | MTB | 86,2 % | 66,3 % (`bicycle=yes/designated` eller `mtb:scale`) | 4,1 % | 20 noder |
| I2-skogen | löpning | 95,2 % | 6,3 % | 0,3 % | 11 noder |
| I2-skogen | MTB | 95,1 % | 63,6 % | 0,4 % | 11 noder |
| Sörmon | löpning | 98,9 % | 6,0 % | 3,9 % | 3 noder |
| Sörmon | MTB | 98,9 % | 77,9 % | 4,1 % | 3 noder |

Tolkning: nätverket är väl sammanhängande (86–99 %), men **uttryckliga tillträdesattribut är sällsynta** (access/foot/bicycle på 0–18 % av ways). Konservativ filtrering ("tillåtet om inte förbjudet") är därför nödvändig, och för löpning/promenad finns nästan inget positivt stöd. Detta är en avvägning, inte ett fel: MTB har bättre stöd via `mtb:scale`.

## 4. Skogsstyrelsen

Skogliga grunddata innehåller lutning (branter), markfuktighet (index 0–100, fyra klasser och vattendragsnät) och terrängskuggning som raster/vektor, tillgängligt via FTP, REST/WMS och SLU:s nedladdningstjänst. **Licens och exakt åtkomst är inte verifierade** (sidan gav 403). Jag har inte prioriterat det: höjdprovtagningen i hybridstudien visade mjuk terräng (max ~24 ° på 100 m-skala, 0–0,2 % över 15 °), så lutning är inte ett ruttkvalitetsproblem i dessa områden. Kan ge värde för ruttkvalitet i kuperad terräng senare.

## 5. Policy för en eventuell kombination (OSM + Lantmäteriet)

Implementeras **inte** i etapp 2.5 (ingen LM-data att validera mot). Krav om det görs:

1. **OSM är primär graf.** LM används som sekundär källa; inga OSM-segment tas bort för att de saknas i LM.
2. **Ursprung per kant:** `src`, käll-id (OSM way-id / LM `objektidentitet`), datasetversion och licens bevaras på varje kant.
3. **Dubblettdetektion med tolerans:** ett LM-segment räknas som täckt om ≥ 80 % av längden ligger inom `max(5 m, √(σ_LM² + σ_OSM²))` (≈ 12 m för gångstig) från OSM-stig. Täckta segment läggs inte till.
4. **Tillägg endast under villkor:** otäckta LM-segment ≥ 100 m läggs till bara om *båda* ändar ansluter till OSM-nätet (inom 10 m från OSM-nod eller delar kant, som då delas), och märks `unverified`. De får användas som ruttförbindelse men inte som checkpoint eller destination.
5. **Ingen sammanslagning vid korsning:** två segment som korsar varandra utan gemensam ändpunkt blir aldrig en korsning (broar, tunnlar, `vagutforande`). Avstånd mellan närliggande segment ger aldrig en kant.
6. **Attribut:** tillträde/cykel bara från OSM; bro/tunnel från båda (LM `vagutforande`, OSM `bridge/tunnel`).
7. **Test:** topologivalidering efter varje sammanslagning (komponentantal får inte minska av falska förbindelser; stickprov mot satellitbild).

### Juridik (inte juridisk rådgivning)

- **OSM (ODbL 1.0):** en härledd databas (t.ex. vår serverade stiggraf) omfattas av share-alike och attribution ("© OpenStreetMap contributors"). Renderade kartor och rutter i appen är "produced works" med attributionskrav.
- **T50 (CC0)** går att kombinera med ODbL utan hinder.
- **T10:** villkoren är *inte* CC0 ("värdefulla datamängder som innehåller personuppgifter"). **Måste läsas innan T10 bakas in i en distribuerad databas.** Ett kombinerat dataset blir i praktiken en ODbL-databas där T10-delen följer sina egna villkor; det kan vara oförenligt och kräver bedömning.
- Slutsats: **tekniskt rimligt, juridiskt sannolikt rimligt för T50 men oklart för T10.** Ingen kombination bör byggas före juridisk granskning.

## 6. Beställning (så körs den uppmätta jämförelsen)

1. Skapa konto på Geotorget och beställ **Topografi 10 Nedladdning, vektor** (och gärna T50 för jämförelse), geografiskt urval Värmlands län (17) eller Karlstads kommun (1780), format GeoPackage, SWEREF 99 TM. Hämta `kommunikation_*.gpkg` (manuellt eller via Geotorgets nedladdnings-API).
2. Läs användningsvillkoren för T10 (PDF).
3. Kör:
   ```bash
   LM_GPKG=/sökväg/kommunikation_kn1780.gpkg npx tsx experiments/data/compare-lm.ts
   ```
   Skriptet jämför total längd, kanter, korsningar, största komponent, återvändsgrenar samt täckning åt båda håll (tolerans 15 m) per område och aktivitet. Läsaren (`lib/gpkg.ts`) är testad mot en syntetisk GeoPackage (`gpkg.test.ts`) och projektionen mot kända värden (centralmeridian, omräkning fram och tillbaka < 1 mm).
4. Mät därefter punkterna 5–9 i uppdraget (stigar bara i OSM/bara i LM, geometri- och anslutningsskillnader, hinder). Utöka vid behov `compare-lm.ts` med de segmentlistor `matchAgainst` redan returnerar (`aOnlySegments`).

## 7. Vad som inte är gjort

- Ingen uppmätt jämförelse OSM mot Lantmäteriet (data kräver inloggning).
- Punkterna 5–7 och 9 i uppdraget (stigar som bara finns i en källa, geometri- och anslutningsskillnader, andel användbart för LM) är därför **inte besvarade med data**.
- Inga hinderfrågor mot LM:s Marktäcke/Byggnader (samma skäl).
- Skogsstyrelsens licens ej verifierad.
