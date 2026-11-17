# Bugg: THE FALL 02 och 04 säger "tre" när banan bara har två mål

**Status:** Åtgärdad 2026-11-17 (alternativ 3 nedan: exakt tre mål). Implementerad och automatiskt testad, inte fälttestad.
**Typ:** Kontinuitet (radio och text), inte spelmekanik.
**Upptäckt:** Narrativ granskning inför Story v1.1 (2026-11-16).

## Beskrivning

Uppdrag 02 (THE SUPPLY RUN) och 04 (THE LAST SIGNAL) har `count: 3, minCount: 2` (`src/campaign/the-fall.ts`). I glesa vägnät
lägger `trimCourse` (`src/campaign/prepare.ts`) ut två mål i stället för tre. Uppdraget fungerar då mekaniskt, men texten och
radion förutsätter tre:

| Uppdrag | Innehåll | Med två mål |
|---|---|---|
| 02 | Intro: "Watchtower has found three places where supplies were left behind." | Två platser på kartan |
| 02 | Mål: "Reach the three supply sites, in any order." | Två |
| 02 | `tf-m02-start`: "Three supply sites on your map." | Två |
| 02 | `tf-m02-first`: "First site cleared. Good. Two to go." | Direkt följt av `tf-m02-win` |
| 02 | `tf-m02-win`: "That is all three." | Bara två har besökts |
| 04 | Intro: "Three sites. Each has to be brought on the air by hand." | Två |
| 04 | `tf-m04-start`: "Three relay sites on your map, in order." | Två |
| 04 | `tf-m04-middle` ("Relay two is live. One more. The main transmitter needs longer.") | Sägs aldrig |

`src/tests/unit/campaign-story.test.ts` ("with two goals (a small network) the story still has a first and a last") visar
förloppet `tf-m02-first` → `tf-m02-win` med två mål.

## Hur ofta (mätt 2026-11-17)

`npx tsx scripts/campaign-goal-count.ts 80 5`: spelets egen förberedelse (`prepareMission`) på Värmlandstilesen, Normal, seeds 1–5,
14 namngivna platser (Karlstad centrum, I2-skogen, Kronoparken, Skutberget, Sörmon, Kristinehamn, Arvika, Sunne, Torsby, Filipstad,
Hagfors, Säffle, Molkom, Deje) och 80 slumpade starter (slumpad tile, slumpad gångbar väg, 0/40/100 m från den, som
`bike-network-eval.ts`; ytviktat, alltså mest landsbygd och skog).

| | Uppdrag 02: spelbara / med två mål | Uppdrag 04: spelbara / med två mål |
|---|---|---|
| Namngivna platser (70 körningar) | 65 / 0 | 65 / 1 (Arvika, seed 5) |
| Slumpade starter (400 körningar) | 270 / 40 (14,8 %) | 305 / 35 (11,5 %) |

Tvåmålsfallen kommer från nät med 2–4 användbara korsningar inom räckhåll (en ensam väg med få förgreningar). Kortare eller längre
bana ändrar det inte, och seeden spelar ingen roll: på de berörda platserna gav alla fem seeds två mål.

## Möjliga åtgärder (beslut: 3)

1. **Repliker för två mål:** nya beats för tvåmålsfallet och en utlösare som vet antalet mål vid start (`MissionStory` får redan
   `goals` i `onEvents`). Kräver ny logik i `story.ts`, nya replik-id:n och nya inspelningar. Befintliga id:n ändras inte.
2. **Neutrala formuleringar:** spela in de berörda replikerna igen utan antal. Enklast, men tar bort konkretion.
3. **Kräv tre mål:** `minCount: 3`. Ändrar var uppdragen går att spela och är en spelmekanisk ändring, inte en textändring.

Introtext och mål kan göras antalsneutrala utan nya inspelningar, men löser inte radion ensamt.

## Åtgärd

**Vald: alternativ 3, kräv tre mål.** Det är den minsta lösningen som gör uppdragskrav, utlagda mål, HUD, intro och radio
konsekventa utan nya inspelningar, och den kan inte glida isär igen eftersom antalet bara finns på ett ställe.

- `src/campaign/the-fall.ts`: `minCount: 3` för 02 och 04.
- `src/routes/course.ts`: ny valfri `minCheckpoints` i `CourseRequest`. Med den föredrar generatorn en placering med tillräckligt
  många mål framför en som bara ligger närmare önskad längd, och släpper en variant som aldrig når antalet. Samma begränsade sökning
  som förut (tre varianter, högst åtta ringstorlekar var); inga extra försök. Utan värdet är generatorn oförändrad (Free Play och
  regressionsavtrycket).
- `src/play/prepare.ts`, `src/campaign/prepare.ts`: kampanjen skickar `minCheckpoints: minCount`.
- Fältloggen skriver `campaign` och `goals` i `match_start`, så att fälttestet kan bekräfta tre mål.

**Effekt** (samma körning efter ändringen): 0 körningar med två mål. Av 76 tidigare tvåmålsfall vägras 75 med det vanliga beskedet
("Too few reachable places around you for this mission…") och 1 får nu tre mål. Banor som redan hade tre mål är oförändrade (629 av 629).
Bland de 80 slumpade starterna kan 8 inte längre spela 02 och 7 inte 04 från just den platsen; ingen av de 14 namngivna platserna
förlorar något. Fem av de åtta platserna kan fortfarande spela 01, 03 och 05. Spelaren kan starta 02 och 04 från en annan plats.

**Motargument:** spelare i glesbygd kan nu fastna på uppdrag 02 tills de flyttar sig. Alternativ 1 skulle låta dem spela där, men
kräver nya beats, ny logik och nya inspelningar (betalda). Ett mellanläge som provats men inte införts: ett enda extra försök med
längre bana (2 000 m) räddar 3 av 8 platser för 02, men ger då banor på upp till 2,1 km i stället för ungefär 1,1 km. Ta upp det
igen om fälttestet visar att vägran är vanlig där folk faktiskt spelar.

**Tester:** `src/tests/unit/campaign-goal-count.test.ts` (generatorn med och utan krav, båda uppdragen på riktig data i tätt och
glest nät; misslyckas om `minCount` sätts tillbaka till 2), `campaign-session.test.ts` (fältloggens `goals`).
Testet i `campaign-story.test.ts` med två mål ligger kvar: det visar att berättelselagret tål ett annat antal, även om kampanjen
inte längre lägger ut det.
