# Fälttest: THE FALL och Free Play med roll-AI

Kort protokoll för nästa telefonprov. Målet är en spelbar och konsekvent första kampanj. Inget här är verifierat på telefon än:
allt i den här filen är frågor som provet ska besvara.

Underlag: [`STATUS-2026-11-17.md`](STATUS-2026-11-17.md) (läge och beslut), [`CAMPAIGN-THE-FALL.md`](CAMPAIGN-THE-FALL.md) §9,
[`ZOMBIE-AI-ROLES.md`](ZOMBIE-AI-ROLES.md) §8.

## 0. Före provet

- **Version.** Kör den build som ska provas, inte den som råkar vara driftsatt. Kontrollera `https://<domän>/version.json` mot commit.
  Ändringarna på branchen `claude/brave-edison-dx7zpy` (tre mål i 02/04, hindertyper i kartdatan, loggning av mål) finns
  bara i en preview-build av den branchen, inte på produktionsadressen.
- **Telefoner:** minst en iPhone och en Android. Appen installerad som PWA (Lägg till på hemskärmen), inte bara i webbläsaren.
- **Inställningar:** Settings → Test mode (`/field`): notera om Wake Lock stöds. Slå på GPS-spår bara om personen vill
  (det sparas lokalt och exporteras bara vid knapptryck). Ljud på, ringljudsknappen på iPhone i läge ljud.
- **Batteri:** notera procent och skärmljusstyrka före och efter varje pass (iPhone har inget Battery API).
- **Säkerhet:** gå på stigar och trottoarer, titta inte på skärmen när du korsar en väg, avbryt när som helst.
- **Plats:** Värmland (Karlstad: centrum och I2-skogen är väl täckta). Undvik glesbygd för kampanjen; där kan uppdrag 02
  och 04 nu vägras med "Too few reachable places around you" (avsiktligt, se statusrapporten §2).

Efter varje pass: exportera loggen i Test mode (`Export`) och fyll i en rad i tabellen i §5.

## 1. THE FALL, uppdelat på tre tillfällen

Välj en svårighet och behåll den. Rekommenderat: **Normal i rask gång eller lätt jogg** (det är så Normal är avsedd, se
statusrapporten §4). En andra person kan köra **Easy i vanlig gång**, för att pröva om Easy är rätt nivå för gående.

| Tillfälle | Uppdrag | Ungefärlig tid | Det viktigaste att observera |
|---|---|---|---|
| A | 01 FIRST CONTACT, 02 THE SUPPLY RUN | 15 + 20 min | Förstår spelaren uppdraget utan hjälp? Blir 01 händelselöst eller för hårt? Finns ett verkligt vägval i 02? |
| B | 03 NO WAY BACK, 04 THE LAST SIGNAL | 20 + 25 min | Märks genskjutningen och går den att lura? Håller zonen i 04 under träd och mellan hus? |
| C | 05 FINAL EXTRACTION | 30 min | Ligger landningsplatsen rimligt, räcker 8 minuter, känns det som en final? |

Per uppdrag, notera kort (ja/nej plus en mening):

1. **Start.** Gick uppdraget att starta där du stod? Om inte: vilket meddelande, och var (ungefärlig plats).
   Hur lång tid tog "SCOUTING THE AREA…" (räkna sekunder, jämför med `routeGenerationMs` i loggen)?
2. **Förståelse.** Kunde du efter briefingen säga vad målet var, utan att fråga någon?
3. **Överensstämmelse.** Stämmer det radion säger med kartan och HUD:en? I 02 och 04: **räkna målen på kartan.**
   Det ska alltid vara tre (loggen: `match_start.goals`). Säger radion "Two to go" efter första, "One left" efter andra?
4. **Tempo.** Vilken fart höll du (gång, rask gång, jogg)? Blev du fångad, och i så fall: kom zombien bakifrån, framifrån
   (genskjutning) eller stod den vid ett mål? Tog tiden slut?
5. **Genskjutning (03, 04 Normal/Hard, 05).** Såg du någon zombie komma emot dig? Bytte du väg, och tappade den dig då
   inom ungefär 15–25 s? Kändes det orättvist?
6. **Ljud.** Hördes radion, och hann du läsa texten i rörelse? Kom repliker för tätt?
7. **Vilja.** Ville du spela nästa uppdrag direkt? (ja / kanske / nej, och varför.)

Gör under tillfälle B eller C **ett** medvetet avbrott: lås skärmen i 20 s mitt i en överföring i 04, och en gång i 60 s.
Notera vad som händer (§3).

## 2. Free Play med roll-AI

Ett pass om ungefär 20 minuter, **Checkpoints eller Survival, On foot, Normal**, i ett område med många korsningar.

- Märks zombier som kommer framifrån? Gick det att se att de "räknade ut" vart du var på väg?
- Byt väg i en korsning när en zombie kommer emot dig. Släpper den inom 15–25 s?
- Står zombier och väntar i korsningar på ett sätt som ser konstigt ut (högst 60 s per punkt)?
- Loggen: antal `zombie_intercept` per match (förväntat 1–5).

Cykel ingår inte i det här provet. Cykelläget är synligt i Free Play men har egna öppna punkter (statusrapporten §1).

## 3. Tekniskt prov på iPhone och Android (installerad PWA)

Görs stillastående eller i lugn gång, gärna i början av ett pass. Ungefär 10 minuter per telefon.

| # | Gör så här | Observera | Förväntat enligt koden (ej verifierat) |
|---|---|---|---|
| T1 | Starta en match, låt skärmen vara på i 5 min utan att röra den | Släcks skärmen? | Wake Lock håller den tänd där det stöds |
| T2 | Lås skärmen i 10 s, lås upp | Fortsätter spelet? Hörs ljudet igen? Kommer GPS-positionen tillbaka inom några sekunder? | Kort frånvaro räknas ikapp, ingen paus |
| T3 | Lås skärmen i 60 s, lås upp | Pausdialog? Fungerar Continue? | Över 45 s pausas spelet och tiden räknas inte |
| T4 | Byt till en annan app (t.ex. kameran) i 20 s, kom tillbaka | Som T2 | Som T2 |
| T5 | Stäng appen helt mitt i ett uppdrag, öppna igen | Återställs uppdraget pausat? Upprepas gamla repliker? | Återställs pausat, gamla repliker sägs inte om |
| T6 | Gå genom en kort tunnel eller under tak | Fryser klockan och zombierna? | Över 5 s utan GPS står allt still |
| T7 | Ringljudsknappen i tyst läge (iPhone) | Hörs något? | Ljudet tystas av knappen (enligt Settings-texten) |
| T8 | Låt en zombie komma inom 200 m (Android och iPhone) | Vibrerar telefonen? | Ja där webbläsaren stöder vibration (Android); iPhone saknar vibration i webben |

Exportera loggen efter provet. Leta efter `background`, `background_return` (med `awayS`), `pause` med `reason: background_long`,
`freeze`, `gps_lost_long` och `fix_*`.

## 4. Loggfält att använda

Allt finns redan i fältloggen (`src/play/fieldlog.ts`, export i Test mode):

| Fråga | Loggfält |
|---|---|
| Vilket uppdrag, hur många mål | `match_start.campaign`, `match_start.goals` (nytt), `match_start.plannedLengthM` |
| Genereringstid | `match_start.routeGenerationMs`, `tiles` (antal, cache, nät) |
| Kartdataversion | `match_start.data` (ska vara `1a44bd309248` med hindertyperna) |
| Radio | `radio` (`id` per replik) |
| Mål och överföring | `objective` (`atS`) |
| Genskjutning | `zombie_intercept` (`inS` = sekunder tills mötet) |
| Kontakt och fångst | `infection_contact`, `finished`, `campaign_result` |
| Avbrott | `background`, `background_return`, `pause` (`reason`), `freeze`, `gps_lost_long` |
| GPS | `fix_*` (avvisade fixar), sammanfattningen vid matchens slut |

## 5. Resultattabell (en rad per pass)

| Datum | Telefon/OS | PWA? | Uppdrag/läge | Svårighet | Fart | Startade? | Mål på kartan | Resultat | Tid | Fångad hur | Förstod målet? | Radio = karta? | Vill spela nästa? | Batteri före/efter | Anteckning |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | | | |

## 6. Vad provet ska avgöra

1. Om THE FALL går att spela från start till slut på riktig GPS utan hjälp, och om radio, karta och HUD stämmer överens.
2. Om Normal är rätt nivå för rask gång eller jogg, och Easy för gång (statusrapporten §4 och §5).
3. Om PWA:n räcker för spel med kartan öppen och korta avbrott (statusrapporten §6). Fortsatt spel med låst telefon i fickan
   provas inte här: det fungerar inte i en webbapp och kräver en separat teknisk prototyp.
