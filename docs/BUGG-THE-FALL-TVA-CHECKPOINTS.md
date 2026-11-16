# Bugg: THE FALL 02 och 04 säger "tre" när banan bara har två mål

**Status:** Öppen. Medvetet inte åtgärdad i THE FALL Story v1.1.
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

## Hur ofta

Okänt. Beror på vägnätet runt spelarens startpunkt. **Logga i fälttestet** hur ofta uppdrag 2 och 4 får två mål innan en åtgärd väljs.

## Möjliga åtgärder (ej beslutade)

1. **Repliker för två mål:** nya beats för tvåmålsfallet och en utlösare som vet antalet mål vid start (`MissionStory` får redan
   `goals` i `onEvents`). Kräver ny logik i `story.ts`, nya replik-id:n och nya inspelningar. Befintliga id:n ändras inte.
2. **Neutrala formuleringar:** spela in de berörda replikerna igen utan antal. Enklast, men tar bort konkretion.
3. **Kräv tre mål:** `minCount: 3`. Ändrar var uppdragen går att spela och är en spelmekanisk ändring, inte en textändring.

Introtext och mål kan göras antalsneutrala utan nya inspelningar, men löser inte radion ensamt.
