# OUTBREAK: REGENESIS
## Story Bible v2.3

**Spel:** OUTBREAK: SOLO SURVIVAL. Detta dokument beskriver spelets första story, **REGENESIS**.
**Format:** GPS-baserad överlevnadsthriller, en story i fem kapitel med fem uppdrag vardera (25 uppdrag)
**Status:** Kanonisk berättelsereferens. Kreativ riktning och produktionsunderlag, inte slutgiltigt manus
**Språk:** Svenskt designunderlag; engelska uppdragstitlar och radiorepliker
**Kärnlöfte:** *Your world. Their outbreak. Every route is a choice.*

---

## 0. Dokumentstatus

| | |
|---|---|
| Version | 2.3 (2026-11-16). Filnamnet `OUTBREAK_STORY_BIBLE_V2_2.md` behålls så att länkar från kod och dokument fortsätter att fungera. |
| Titel | OUTBREAK: REGENESIS. Hette OUTBREAK: THE ACCELERATION till och med v2.2 (avsnitt 23). |
| Ersätter | v2.2 (samma fil, se git-historiken och avsnitt 23). Story Bible v2.0 (filnamn `OUTBREAK_STORY_BIBLE_V2_1.md`) är arkiverad i [`docs/story/archive/`](story/archive/OUTBREAK_STORY_BIBLE_V2_1.md) |
| Kanon | Detta dokument. Vid konflikt mellan detta dokument och koden gäller **koden för vad som finns**, och detta dokument för **vad som ska gälla**. En konflikt är en bugg i ett av dem och rättas. |
| Implementerat innehåll | Endast THE FALL (kapitel 1), Story v1.1. Källa: `src/campaign/the-fall.ts`; storyns struktur i `src/campaign/stories.ts`. Teknisk beskrivning: [`docs/CAMPAIGN-THE-FALL.md`](CAMPAIGN-THE-FALL.md) |

**Statusmarkeringar i dokumentet:**

- **[IMPLEMENTERAT]**: finns i koden och spelas under normala förhållanden. Texten här citerar koden.
- **[PLANERAT]**: berättelsebeslut för framtida innehåll. Inget av det finns i koden.
- **[KRÄVER NY MEKANIK]**: planerat innehåll som förutsätter en funktion som motorn inte har i dag (se avsnitt 17).

### Titeln REGENESIS

**REGENESIS** har dubbel betydelse. Det är namnet på NEXAGEN:s experimentella behandling (avsnitt 2), och det är titeln på spelets första större berättelse. Titeln pekar alltså på berättelsens orsak. Spelaren ser ordet som storyns namn redan i THE FALL, men får inte veta vad det betyder förrän i GROUND ZERO (2.2): ingen replik, intro eller epilog i THE FALL nämner REGENESIS, och titeln förklaras inte i spelet (avsnitt 11 och 16). Titeln är ett löfte, inte ett avslöjande. Temat från den tidigare arbetstiteln THE ACCELERATION finns kvar oförändrat: AI-accelererad forskning där människor lät tempot gå före säkerheten är fortfarande berättelsens bakgrund och mänskliga konflikt (avsnitt 2 och 3).

### Struktur och begrepp

| Nivå | I REGENESIS | Betydelse |
|---|---|---|
| Spel | OUTBREAK: SOLO SURVIVAL | Hela spelet. Namnet ändras inte. |
| CAMPAIGN | Spelläget i huvudmenyn | Berättelsedrivet spel, bredvid FREE PLAY. Rymmer en eller flera stories. |
| STORY | **REGENESIS** | En sammanhängande större berättelse med egna kapitel. |
| CHAPTER | THE FALL, GROUND ZERO, THE HUNT, NO MAN'S LAND, THE LAST HOPE | En del av storyn, spelad i ordning. |
| MISSION | Fem per kapitel i REGENESIS, 25 totalt | Ett spelbart uppdrag. |

REGENESIS har fem kapitel med fem uppdrag vardera. Det är ett beslut för den här storyn, inte en regel: framtida stories kan ha andra antal kapitel och uppdrag. Endast kapitel 1, THE FALL, är implementerat. I koden heter ett kapitel fortfarande `CampaignDef` och lagras under sitt kapitel-id (`the-fall`); se avsnitt 21.

**Viktigaste ändringarna i v2.3:** Titeln OUTBREAK: THE ACCELERATION är bytt till OUTBREAK: REGENESIS, och hierarkin Story → Chapter → Mission är fastställd. Det som tidigare kallades "kampanj 1–5" heter nu "kapitel 1–5"; CAMPAIGN avser bara spelläget. Ingen berättelse, replik, tidslinje eller uppdrag är ändrad (avsnitt 23).

**Viktigaste ändringarna i v2.2** (fullständig lista i avsnitt 22):

1. Exakt **tre återkommande talande huvudroller**: WATCHTOWER, RAVEN TWO och DR. ELENA VOSS. Maya, Leo, Jonas och Sara är borttagna eller sammanslagna.
2. Den försvunna **evakueringsstyrkan (anropssignal SHEPHERD)** är berättelsens huvudtråd från THE FALL till NO MAN'S LAND. SHEPHERD är en enhet, inte en karaktär.
3. SHEPHERD skickades till **NEXAGEN:s medicinska mottagnings- och logistikbyggnad**, registrerad som möjlig säker uppsamlingsplats i regionens beredskapsplan. Ingen utanför NEXAGEN kände till kopplingen till forskningen.
4. **THE BUNKER** är ett fristående Safehouse. WATCHTOWER:s position är okänd för spelaren.
5. THE FALL beskrivs som den faktiskt är implementerad, inklusive slutrepliker och epilog.
6. THE WAYSTATION är den säkra zonen i THE FALL uppdrag 3.
7. Tidslinjen justerad: THE FALL spänner över dag 0–1.
8. Zombiernas genskjutning beskrivs som instinkt, i linje med implementerad zombie-AI.

---

## 1. Vision och fastställda principer

Outbreak är ett berättelsedrivet GPS-spel där spelaren rör sig i sin verkliga omgivning medan fiktiva infekterade förföljer, blockerar och försöker nå samma mål. Spelarens vägval påverkar förloppet. Berättelsen förmedlas främst via radio, korta filmiska bilder och fynd vid geografiska checkpoints.

**Fastställda principer**

- **Zombierna är de enda aktiva fienderna på kartan.** Ingen militär fiende-AI, inga soldater som jagar spelaren, ingen konspiration med beväpnade motståndare, inga UFO:n eller övernaturliga förklaringar.
- Militären och myndigheterna kan förekomma i bakgrunden, i evakueringar och i radiotrafik, men aldrig som motståndare.
- **Tre återkommande talande huvudroller:** WATCHTOWER, RAVEN TWO, DR. ELENA VOSS. Spelaren är RUNNER SEVEN och talar aldrig.
- **Safehouses är återkommande berättelseplatser**, inte ett crafting- eller basbyggarsystem, och de har inga egna återkommande röster.
- Spelaren börjar med att försöka överleva, och engagerar sig därefter i att hitta och rädda andra. Världens framtid är en följd av insatserna, inte en tidig hjälteorder. Forskningsmysteriet växer fram **som en konsekvens av räddningsuppdraget**; spelaren blir aldrig forskningsutredare.
- AI-accelererad läkemedelsutveckling är bakgrund till katastrofen. **AI är inte en ond aktör** och styr inte zombierna. Ansvaret ligger hos människor som lät tempot gå före säkerheten.
- Kapitel 1, **THE FALL**, är implementerat. Dess fem uppdrag, mål, spellängder, svårighetsgrader, radiorepliker, ljud och bilder bevaras. Ändringar i THE FALL görs bara som små textlager.
- Varje uppdrag ska fungera på olika verkliga kartor. Fiktiva miljöer representeras av säkra, offentligt tillgängliga GPS-zoner, aldrig av faktiska byggnader som spelaren måste gå in i.

**Avgränsning:** Inget inventory, ingen crafting, ingen strid, ingen basbyggnad och ingen fysisk interaktion med omgivningen. Evidence Log är ett berättelsearkiv, inte ett resurssystem.

---

## 2. Värld och bakgrund

**År 2027.** Bioteknikföretaget **NEXAGEN** utvecklar **REGENESIS**, en experimentell behandling av svåra neurologiska skador och sjukdomar. NEXAGEN har ett regionalt forsknings- och produktionsområde utanför staden där spelet utspelar sig. Platsen är fiktiv och har ingen motsvarighet på spelarens karta.

**AI:s roll.** AI-modeller har kortat urvalet av behandlingskandidater från år till veckor. Det gav NEXAGEN ett försprång och en tidsplan som byggde på att försprånget behölls. Modellerna gjorde vad de var byggda för. Problemet var att människorna runt dem lät den nya takten bestämma hur lång tid säkerhetsprocesserna fick ta: steg som tidigare tog månader komprimerades, och avvikelser bedömdes mot en tidsplan i stället för mot risk. AI är bakgrund till tempot, inte en aktör i berättelsen.

**Fiktiv biologi.** I REGENESIS används en modifierad biologisk bärare för att påverka nervsystemet. Tidiga avvikelser visar förhöjd aggression, överkänslighet för ljud och rörelse samt förlust av impulskontroll. Forskarna inser för sent att en förändrad variant kan överföras mellan människor. Detta är **fiktion**, inte en faktisk känd riskprofil för AI-utvecklade läkemedel, och spelet ska aldrig framställa det som en verklig risk. Exakta smittvägar och medicinska effekter lämnas medvetet på thriller-nivå.

**NEXAGEN och beredskapsplanen.** I utkanten av NEXAGEN-området, åtskild från forskningsbyggnaderna, ligger företagets **medicinska mottagnings- och logistikbyggnad**: patientmottagning för kliniska prövningar, varumottagning, kylförvaring, reservkraft, stora lastytor och en helikopterplatta. Flera år före utbrottet erbjöd NEXAGEN byggnaden till regionens beredskapsplanering, och den registrerades som **möjlig säker uppsamlingsplats vid evakuering**. Det var en rimlig och vanlig typ av avtal: byggnaden hade allt en uppsamlingsplats behöver, och den låg utanför stadens centrum.

När utbrottet kom fanns ingen anledning att misstänka byggnaden. **Ingen utanför NEXAGEN kände till kopplingen mellan företagets forskning och utbrottet.** Det är kärnan i bryggan mellan THE FALL och GROUND ZERO (avsnitt 7).

---

## 3. Berättelsens centrala konflikt

**Yttre konflikt:** Människor mot en sjukdom som sprids snabbare än samhället hinner reagera. De infekterade är ett naturfenomen i berättelsen, inte en fiende med avsikter.

**Mänsklig konflikt:** Tempo mot försiktighet. NEXAGEN:s ledning fördröjde larmet för att verifiera, skydda programmet och undvika panik. Elena Voss försökte varna, men först efter att själv ha accepterat för stora osäkerheter. Civilförsvaret följde en beredskapsplan som pekade ut en NEXAGEN-byggnad som säker. Ingen av dem är skurk; alla bidrog.

**Personlig konflikt (berättelsens motor):** WATCHTOWER skickade evakueringsstyrkan SHEPHERD till NEXAGEN:s mottagningsbyggnad, eftersom planen angav den som säker uppsamlingsplats, och tappade kontakten. Hon ber Runner Seven hjälpa henne att hitta dem. Det spelaren upptäcker längs vägen avslöjar steg för steg varför planen var fel, och att en varning fanns som aldrig nådde fram.

**Berättelsens fråga:** Kan det som gick förlorat i hastigheten räddas med tålamod: människorna, och kunskapen om vad som hände?

---

## 4. Tidslinje

| Tid | Händelse | Vad spelaren får veta, och när |
|---|---|---|
| Dag −3 | Allvarlig neurologisk avvikelse vid REGENESIS-försök | GROUND ZERO 2.2 |
| Dag −2 | Misstänkt sekundärsmitta bland personal; internt säkerhetsstopp | GROUND ZERO 2.2 |
| Dag −1 | Rapporteringen fördröjs. Sjuka anställda söker sig till mottagningsbyggnaden. Elena ringer civilförsvaret utanför företagets kanaler och ber dem att inte använda byggnaden som uppsamlingsplats; meddelandet hamnar i en kö i sambandsnätet och eskaleras aldrig. En smittad person lämnar området. | GROUND ZERO 2.3–2.5 |
| Dag 0, eftermiddag | Utbrottet bryter ut i staden. Räddningstjänst och kommunikation bryter samman. | THE FALL 01 [IMPLEMENTERAT] |
| Natt dag 0–1 | Spelaren överlever natten (mellan uppdrag 1 och 2). WATCHTOWER skickar evakueringsstyrkan SHEPHERD från THE WAYSTATION till NEXAGEN:s mottagningsbyggnad för att öppna uppsamlingsplatsen. | THE FALL 01 success-text; SHEPHERD:s rutt i GROUND ZERO 2.1 |
| Dag 1, dag | Förnödenheter till gruppen i källaren | THE FALL 02 [IMPLEMENTERAT] |
| Dag 1, eftermiddag | Evakueringsvägen bryts. Spelaren når THE WAYSTATION. SHEPHERD tystnar. | THE FALL 03 [IMPLEMENTERAT] |
| Dag 1, kväll | Sex timmar utan kontakt. Relänätet aktiveras; RAVEN TWO svarar. | THE FALL 04 [IMPLEMENTERAT] |
| Dag 1, natt | Utdrivning med RAVEN TWO. Ett brutet anrop från SHEPHERD fångas upp. | THE FALL 05 och epilog [IMPLEMENTERAT] |
| Dag 2–4 | Sökandet efter SHEPHERD; NEXAGEN:s roll framträder | GROUND ZERO [PLANERAT] |
| Dag 5–7 | Nödsignalen spåras; en familj i ett trädhus; Elena hörs live | THE HUNT [PLANERAT] |
| Dag 8–10 | Räddning av vårdstationen där Elena och SHEPHERD:s överlevande finns | NO MAN'S LAND [PLANERAT] |
| Dag 11–12 | Forskningsdata förs ut till omvärlden; gryning | THE LAST HOPE [PLANERAT] |

**Tidsregel för THE FALL:** Spelet anger aldrig klockslag. De tidsangivelser som finns i texten ("It started this afternoon", "You made it through the first night", "No one has heard from the evacuation force in six hours", "Twenty-two minutes out") ska fortsätta att stämma med tabellen ovan.

---

## 5. Huvudroller

Berättelsen har **exakt tre återkommande talande huvudroller**. Ingen fjärde återkommande röst får tillkomma utan beslut om ny version av detta dokument.

### RUNNER SEVEN (spelaren)
Spelarens anropssignal, tilldelad av WATCHTOWER i slutet av FIRST CONTACT: *"I am logging you as Runner Seven."* [IMPLEMENTERAT]. Runner Seven talar aldrig, har inget namn, kön eller ålder i berättelsen. Alla relationer byggs genom vad andra säger till och om Runner Seven.

### WATCHTOWER
**Roll:** Civilförsvarets radiooperatör. Spelarens huvudsakliga radiokontakt. Leder uppdragen och håller ihop berättelsen. Förmedlar information om överlevare, Safehouses och hot. Förekommer i alla fem kapitel och i alla 25 uppdrag.

**Identitet:** Kvinna i fyrtioårsåldern. Identifieras **endast med anropssignalen WATCHTOWER**. Hon har inget civilt namn i berättelsen och ska inte få något.

**Position:** Var WATCHTOWER sänder ifrån är **okänt för spelaren** och ska förbli det tills ett särskilt beslut fattas (avsnitt 22). THE FALL säger bara att hon är kvar på sin post. Repliker får inte avslöja platsen, och inget Safehouse är hennes post.

**Röst:** Lugn, exakt, trött men med kontroll. Procedurmässigt radiospråk utan drama; brådskande bara när spelaren är på väg att bli fångad. [IMPLEMENTERAT som röstregi i `the-fall.ts`]

**Båge:**

| Kapitel | Utveckling |
|---|---|
| THE FALL | Från procedur ("Any station, this is Watchtower") till ett första personligt band: hon ger spelaren en anropssignal och ser till att *en* människa kommer ut. |
| GROUND ZERO | Personlig skuld. Hon skickade SHEPHERD till en byggnad som planen kallade säker. Hon ber Runner Seven om hjälp, inte på order. När Elenas köade varning spelas upp (2.4) förstår hon att varningen fanns i hennes eget sambandsnät. |
| THE HUNT | Hon gör misstag (3.3) och säger det. Hon börjar fatta egna beslut utanför den officiella strukturen, som inte längre finns. |
| NO MAN'S LAND | Hon är skeptisk och ibland skarp mot Elena; det är hennes organisation som fick bära företagets fel. Hon väljer ändå att rädda henne, för att människorna på gården behöver det. |
| THE LAST HOPE | Hon har tagit ansvar för ett litet nät av överlevare. Sista repliken i hela berättelsen är hennes. |

**Funktion i berättelsen:** WATCHTOWER övertar alla funktioner som tidigare låg på bifigurer: hon förmedlar överlevarnas läge, läser fynd för spelaren, gör lokala bedömningar och är rösten som ifrågasätter Elena.

### RAVEN TWO
**Roll:** Pilot i en räddningshelikopter som fortfarande flyger. Återkommande räddningskontakt. Introduceras i THE FALL uppdrag 4 och 5 [IMPLEMENTERAT]. Militär eller statlig enhet hör till bakgrunden och är aldrig en motståndare.

**Identitet:** Man. Identifieras **endast med anropssignalen RAVEN TWO**. Inget civilt namn.

**Röst:** Kort flygradio, rotorljud bakom rösten. Saklig, aldrig stressad förrän vid landningen. [IMPLEMENTERAT som röstregi]

**Användningsregel:** RAVEN TWO är en sällsynt resurs, inte en extra berättarröst. Han medverkar endast när en verklig lufttransport är möjlig eller när den uttryckligen *inte* är möjlig och det driver handlingen. Väder, bränsle, landningsförhållanden och andra räddningsuppdrag kan förhindra honom.

**Medverkan över 25 uppdrag (tak):** THE FALL 04, 05 · THE HUNT 3.4 (kan inte komma) · NO MAN'S LAND 4.3 (kan inte landa), 4.5 (evakuering) · THE LAST HOPE 5.3 (kan bara hjälpa efter sändningen), 5.5 (slutet). Ingen medverkan i GROUND ZERO. Totalt högst sju uppdrag.

### DR. ELENA VOSS
**Roll:** Forskningsledare i REGENESIS hos NEXAGEN.

**Personlighet och komplexitet:** Elena är ingen galen forskare och ingen helgonlik visselblåsare. Hon trodde på behandlingen; den var utformad för patienter som saknade alternativ, och de tidiga resultaten var verkliga. Hon godkände själv komprimerade säkerhetssteg när AI-urvalet gav ovanligt säkra prognoser. När avvikelserna kom ville hon stoppa försöken, men gick först den interna vägen och väntade på verifiering i ett dygn hon inte hade. Hennes samtal till civilförsvaret dag −1 var försiktigt formulerat för att inte bryta mot företagets sekretess, och därför eskalerades det aldrig. Hon bär den skulden och försöker inte förklara bort den.

**Vad hon har:** Dokumentation och preliminära data om hur sjukdomsförloppet eventuellt kan bromsas. **Inget färdigt botemedel**, och hon påstår aldrig att hon har ett.

**Röst:** Kvinna, femtiotal. Precis, trött, ibland för snabb när hon talar om data; stannar upp när hon talar om människor. Låter som någon som är van att bli trodd och som inte längre är det.

**Gradvis introduktion:**

| Steg | Var | Form |
|---|---|---|
| 0 | THE FALL | **Ingen förekomst.** Epilogens fragment kommer från SHEPHERD, inte från Elena. |
| 1 | GROUND ZERO 2.2 | Hennes namn som underskrift på ett dokument (text, ingen röst). |
| 2 | GROUND ZERO 2.4 | **Första tydliga framträdandet:** hennes köade samtal från dag −1, en inspelning. |
| 3 | GROUND ZERO 2.5 | Indirekt: SHEPHERD:s sista logg nämner att "the researcher" hjälpte dem ut. |
| 4 | THE HUNT 3.5 | Första **live**-kontakten, ett nödmeddelande. |
| 5 | NO MAN'S LAND | Större roll: talar live i flera uppdrag, leder vårdstationen. |
| 6 | THE LAST HOPE | Central: hennes data är det som ska räddas; hon talar under överföringen. |

**Namnregel:** Efternamnet Voss används endast för forskaren. Den tidigare militära antagonisten finns inte.

### Röster i produktionen: karaktär är inte röstmodell

Karaktärernas namn och ElevenLabs-rösternas tekniska namn är olika saker och får inte blandas ihop i manus, filnamn eller diskussioner.

| Karaktär (i berättelsen) | ElevenLabs-röst (tekniskt namn) | Voice ID | Status |
|---|---|---|---|
| WATCHTOWER | Kristen | `Qbw4VpyUrHEG7NigKzty` | [IMPLEMENTERAT] 44 repliker i THE FALL |
| RAVEN TWO | Morgan | `SAxJUlDKRc79XAyeWyMu` | [IMPLEMENTERAT] 6 repliker i THE FALL |
| DR. ELENA VOSS | Ej vald | – | [PLANERAT] väljs före GROUND ZERO 2.4. Får inte vara Kristen eller Morgan. |
| Anonyma röster (avsnitt 6) | Högst två delade röster, ej valda | – | [PLANERAT] |

**"Morgan" är röstmodellen för RAVEN TWO och ingenting annat.** I v2.0 hette WATCHTOWER "Morgan"; det namnet är borttaget. Källa för voice ID: `speakers` i `src/campaign/the-fall.ts`.

---

## 6. Övriga människor

Berättelsen behöver människor att rädda, men inte fler röster att följa. Alla andra människor än de tre huvudrollerna existerar som:

- **Anonyma personer eller grupper i Safehouses** ("eleven people in a cellar", "the family in the treehouse", "the people at the farm").
- **Människor som WATCHTOWER berättar om.**
- **Personer som spelaren hjälper genom sina uppdrag**, utan att eskortera verkliga personer.
- **Enstaka anonyma radiosändningar eller inspelningar.**

**Regler för anonyma röster:**

1. Högst **en anonym röst per uppdrag**, och högst tre korta repliker från den.
2. En anonym röst har en funktion (en signal, ett vittnesmål, en bekräftelse), inte en personlighet att följa.
3. Ingen anonym person får namn, återkommande röst eller egen båge. Om en funktion kräver det ska den läggas på en av huvudrollerna.
4. Barns röster används inte. Barn i berättelsen hörs genom vad WATCHTOWER säger om dem.
5. Anonyma röster spelas in med högst två delade röster för hela berättelsen (exempelvis "SHEPHERD operator" och "research network").

### Borttagna och sammanslagna roller (från v2.0)

| v2.0-roll | Beslut i v2.2 | Var funktionen nu finns |
|---|---|---|
| WATCHTOWER "Morgan" (civilt namn) | Namnet borttaget | WATCHTOWER har bara anropssignal. "Morgan" är RAVEN TWO:s röstmodell. |
| MAYA och LEO (syskon i trädhuset) | Borttagna som namngivna karaktärer | En anonym familj i THE TREEHOUSE. Den känslomässiga insatsen och skälet att återvända finns kvar; WATCHTOWER förmedlar deras läge. |
| JONAS (skogsvaktare, radioamatör) | Borttagen | Hans kunskap blir ett fynd: en anonym skogsvaktares fältanteckningar (E-09) vid THE RANGER STATION. Varningen i 3.3 och förslaget om sirenen i 4.4 flyttas till WATCHTOWER. |
| SARA (sjuksköterska) | Sammanslagen med Elena och WATCHTOWER | Elena leder vårdstationen och står för det medicinska. Den skeptiska rösten som balanserar Elena blir WATCHTOWER:s. |
| Radioamatörerna på THE ROOFTOP | Anonym grupp utan röst | WATCHTOWER talar om dem. |
| Räddningsgruppen i GROUND ZERO (ny i v2.0) | Ersatt | Den befintliga evakueringsstyrkan från THE FALL, SHEPHERD (avsnitt 7). En enhet med anropssignal, inte en karaktär. |
| Internationell forskargrupp | Anonym | En anonym röst, en gång (THE LAST HOPE 5.4). |

---

## 7. Huvudtråden: evakueringsstyrkan SHEPHERD

**Vad den är:** En civil evakueringsstyrka från räddningstjänst, ambulanssjukvård och civilförsvar: fordon, sjukvårdare och ett sambandsfordon. Anropssignal **SHEPHERD**. Inte militär.

**SHEPHERD är en evakueringsstyrka, inte en huvudroll.** Regler:

- Anropssignalen tillhör enheten, aldrig en person. Ingen medlem får namn, egen båge eller återkommande röst utanför GROUND ZERO.
- I GROUND ZERO hörs styrkan i **3–5 korta inspelningar** (radiologgar, ett avbrutet anrop), alla från **samma anonyma sambandsoperatör**. Operatören har inget namn och ingen personlig historia; inspelningarna är information, inte en relation.
- Efter GROUND ZERO hörs SHEPHERD inte mer. Elena och WATCHTOWER talar om de överlevande.

**I THE FALL [IMPLEMENTERAT]:** Spelaren hör bara om "the evacuation force", aldrig anropssignalen.

- Uppdrag 2, success: *"The supplies are in. The group can hold out, but the evacuation routes are closing."*
- Uppdrag 3, success: *"You are inside the Waystation. But the evacuation force has gone silent."*
- Uppdrag 3, radio (`tf-m03-win`): *"You are in. Gate is sealed. … Runner, I have lost the evacuation force. Nothing on any channel. There is an old relay network near you. It may be the last way to reach them."*
- Uppdrag 4, intro: *"No one has heard from the evacuation force in six hours."*
- Epilog: *"One call does not belong. The evacuation force, hours after she lost them: “…NEXAGEN perimeter… do not…” Then static."*

**Varför styrkan skickades till NEXAGEN:** NEXAGEN:s medicinska mottagnings- och logistikbyggnad var registrerad i regionens beredskapsplan som möjlig säker uppsamlingsplats (avsnitt 2). När staden började evakueras natten mellan dag 0 och dag 1 behövde WATCHTOWER en plats med kraft, utrymme och helikopterplatta, och planen pekade på byggnaden. Hon skickade SHEPHERD från THE WAYSTATION för att öppna den, så att bussar med evakuerade kunde följa efter. Ingen hos civilförsvaret visste något om REGENESIS.

**Varför styrkan försvann:** Smittan hade börjat bland NEXAGEN:s personal, och sjuka anställda hade sökt sig till mottagningsbyggnaden, där den medicinska mottagningen fanns. SHEPHERD kom fram till en byggnad som redan var en smitthärd. De förstod vad det betydde för bussarna bakom dem och försökte varna: *do not send the buses, do not send anyone*. Sedan tystnade de.

**Varför det driver berättelsen:** WATCHTOWER följde planen och skickade människor in i det de skulle evakueras undan. Det är hennes personliga skäl att ta reda på vad som hände, och det är därför sökandet efter SHEPHERD oundvikligen blir ett sökande efter sanningen om NEXAGEN.

**Varför spelaren bryr sig:** Det är samma styrka som WATCHTOWER väntade på genom hela THE FALL, och evakueringen spelaren själv var en del av. WATCHTOWER skickade dem dit. Hon ber om hjälp att hitta dem.

**Trådens förlopp:**

| Kapitel | SHEPHERD |
|---|---|
| THE FALL | Tystnar (03). Ett brutet anrop i epilogen. |
| GROUND ZERO | Spelaren följer deras väg: från THE WAYSTATION, via deras rutt, till mottagningsbyggnaden vid NEXAGEN-områdets yttre gräns. De tog sig ut med en del av personalen, med hjälp av "the researcher". Ett okänt antal lever. 3–5 inspelningar från den anonyma operatören. |
| THE HUNT | Deras spår leder vidare via nödsignalen. |
| NO MAN'S LAND | Två av SHEPHERD:s sjukvårdare finns på THE FARMHOUSE och räddas i 4.5. De talar inte; Elena och WATCHTOWER talar om dem. Tråden avslutas. |
| THE LAST HOPE | WATCHTOWER nämner dem en gång: de hjälper till i nätet. |

---

## 8. Safehouses

Safehouses är **fiktiva överlevnadsplatser** knutna till lämpliga GPS-zoner. De fungerar som GPS-destinationer och narrativa miljöer, representeras med filmiska bilder, ljud och radioberättande, kan återkomma, förändras, hotas eller överges, och kräver aldrig att spelaren går in i en verklig byggnad. De har **inga ägare och inga egna återkommande röster**; de människor som finns där är anonyma (avsnitt 6).

Varje Safehouse har en **egen berättelsefunktion**. En plats som bara skiljer sig visuellt ska inte läggas till.

| ID | Safehouse | Berättelsefunktion | Människor | Framträdanden | Förändring |
|---|---|---|---|---|---|
| SH-01 | **THE WAYSTATION**, provisoriskt vägskydd vid den gamla vägstationen | **Minnet.** Platsen där spelaren räddades, och där SHEPHERD utgick. Startpunkten för mysteriet. | Okända evakuerade (THE FALL), inga (GROUND ZERO) | THE FALL 03 [IMPLEMENTERAT], GROUND ZERO 2.1 | Trygg med stängd port → övergiven, med SHEPHERD:s radio kvar |
| SH-02 | **THE BUNKER**, gammalt civilförsvarsskydd med en nod i sambandsnätet | **Arkivet.** En nod i sambandsnätet som ingen operatör längre bemannar: radioutrustning och en meddelandelagring som sparar trafik som inte kunnat vidarebefordras. Där kan fynd läsas in och sändas till WATCHTOWER, och där ligger nätets glömda meddelanden. **Inte WATCHTOWER:s post.** | En anonym grupp överlevare som tagit skydd där | GROUND ZERO 2.3, 2.4; THE LAST HOPE 5.1 | Trygg (2.3) → hotad när reservkraften sviktar (2.4) → förlorar delar av kraften och överges när gruppen flyttar till THE ROOFTOP (5.1) |
| SH-03 | **THE TREEHOUSE**, gömställe i träden | **Människorna att skydda.** Det första stället där spelaren gör skillnad för andra genom att återvända. | En anonym familj, två barn och en vuxen | THE HUNT 3.1, 3.4; omnämnd i THE LAST HOPE 5.5 | Trygg → hotad av en hord → utrymd och övergiven |
| SH-04 | **THE RANGER STATION**, obemannad skogsstuga med gammal repeater och brandsiren | **Verktyget.** Kunskap och utrustning: fältanteckningar om ljud, repeatern, sirenen. | Inga (den anonyma skogsvaktaren är försvunnen) | THE HUNT 3.2, 3.3; NO MAN'S LAND 4.4 | Observationspunkt → fälla (3.3) → sirenen används för avledning (4.4) |
| SH-05 | **THE FARMHOUSE**, befäst gård, provisorisk vårdstation | **Räddningsmålet.** Elenas station och slutet på SHEPHERD-tråden. | Elena, anonyma patienter, två SHEPHERD-sjukvårdare | NO MAN'S LAND 4.1–4.5 | Fungerande vårdstation → omringad → evakuerad |
| SH-06 | **THE ROOFTOP**, takläger med sändare | **Rösten utåt.** Den enda platsen som kan nå omvärlden. | En anonym grupp radioamatörer | THE LAST HOPE 5.2–5.5 | Sändarplats → under press under överföringen → övergiven i gryningen |

**Andra platser är inte Safehouses.** Källaren med elva personer (THE FALL 02) och NEXAGEN:s mottagningsbyggnad (GROUND ZERO 2.5, endast som fiktiva zoner runt den) är engångsplatser.

**Safehouse-loop [KRÄVER NY MEKANIK]:** GPS-zon nås → kort filmisk bild och miljöljud → radiodialog → fynd eller beslut → nästa mål. Längre scener och Evidence Log läses efter avslutat uppdrag, inte under rörelse.

**I dag [IMPLEMENTERAT]:** Uppdrag med `ending: "safehouse"` (THE FALL 03) avslutas med dörrljudet `safeDoor` och bilden `/img/safehouse.jpg`. Det finns ingen ankomstscen, inget återbesöksläge och ingen Safehouse-specifik bild.

**Återkommande motiv:** Samma miljöbild kan få förändrad belysning, ljudbild eller detaljer vid senare besök. En tidigare trygg plats som nu är tom ska ha en begriplig orsak, inte vara en slumpmässig jumpscare.

---

## 9. Regler för infekterade och spelvärlden

**De infekterade:**

- Reagerar på **ljud, rörelse och närhet**. De har ingen mänsklig strategi, ingen kunskap om uppdragsmål och ingen kommunikation.
- **Förföljelse:** När de har uppfattat spelaren följer de efter.
- **Genskjutning är instinkt, inte plan.** En del infekterade läser spelarens rörelseriktning och rusar mot en punkt framför, som ett rovdjur som skär av ett byte. De vet aldrig vart spelaren ska, bara vart spelaren har varit på väg. Byter spelaren riktning tappar de bytet och följer efter igen. [IMPLEMENTERAT: `interceptModel: "track"`, se `docs/CAMPAIGN-THE-FALL.md` §4]
- **Tätare grupper blir farligare.** Ju fler de är, desto snabbare och mer sammanhållet rör de sig, som en flock som driver varandra. [IMPLEMENTERAT som `intensity` i THE FALL 05]
- **Sjukdomen framskrider.** Under de första dygnen blir beteendet mer drivet. Det förklarar repliker som *"the infected have started to hunt differently"* (THE FALL 03) och *"They are hunting in groups now"* (THE FALL 05) utan att tillskriva dem planering.
- **Ljud drar dem till sig.** Signaler, sirener och helikoptrar lockar dem. [IMPLEMENTERAT: `transmitSpawn` i THE FALL 04, *"The transmissions are pulling them in"*]
- Horder kan nå samma plats som spelaren om båda dras dit av en tydlig orsak (siren, helikopter, sändning). Orsaken måste höras eller synas i spelet.

**Formuleringsregel för radion:** Beskriv vad de *gör* ("they are cutting ahead", "the signal is pulling them in"), aldrig vad de *tänker* eller *planerar* ("they are trying to trap you", "they know where you are going").

**Spelvärlden:**

- Inga levande mänskliga fiender. Människor spelaren möter (genom radio) är överlevare, hjälpare eller frånvarande.
- Myndigheter och militär finns i bakgrunden: evakueringsplaner, helikoptrar, avlägsna anrop. De är aldrig motståndare och jagar aldrig spelaren.
- Inget inventory: "supplies", "data" och "uplink key" är berättelseobjekt som registreras automatiskt när en zon nås.

---

## 10. Kapitlens berättelsebågar

| # | Kapitel | Akt | Tagline | Dagar | Dramatisk fråga | Röster | Safehouses |
|---|---|---|---|---|---|---|---|
| 1 | **THE FALL** [IMPLEMENTERAT] | SURVIVE | *The world is ending. Stay alive.* | 0–1 | Kommer spelaren undan den första vågen? | WATCHTOWER, RAVEN TWO | THE WAYSTATION |
| 2 | **GROUND ZERO** | DISCOVER | *Find the missing. Uncover the truth.* | 2–4 | Vad hände med SHEPHERD, och varför tystnade de? | WATCHTOWER; Elena som inspelning; anonym SHEPHERD-röst | THE WAYSTATION, THE BUNKER |
| 3 | **THE HUNT** | CONNECT | *They follow sound. They follow you.* | 5–7 | Kan spelaren spåra nödsignalen och samtidigt skydda dem som finns på vägen? | WATCHTOWER; RAVEN TWO (en gång); Elena live (3.5) | THE TREEHOUSE, THE RANGER STATION |
| 4 | **NO MAN'S LAND** | RESCUE | *Someone is still alive. Get them out.* | 8–10 | Går det att rädda en hel grupp när de infekterade redan närmar sig? | WATCHTOWER, Elena, RAVEN TWO | THE FARMHOUSE, THE RANGER STATION |
| 5 | **THE LAST HOPE** | PRESERVE | *Save the research. Give them a chance.* | 11–12 | Kan kunskapen nå omvärlden innan sambandet försvinner? | WATCHTOWER, Elena, RAVEN TWO; anonym forskarröst (en gång) | THE BUNKER, THE ROOFTOP |

**Hur kapitlen hänger ihop:**

1. **THE FALL** slutar med att spelaren är räddad, men SHEPHERD saknas och ett brutet anrop nämner NEXAGEN.
2. **GROUND ZERO** är ett räddningsuppdrag som blir ett avslöjande: spelaren följer SHEPHERD till byggnaden som planen kallade säker och förstår att NEXAGEN visste före alla andra. Slutar med att SHEPHERD:s överlevande kan ha tagit sig vidare med en forskare, och en svag nödsändare.
3. **THE HUNT** spårar nödsändaren. Spelaren lär sig hur de infekterade reagerar på ljud, hjälper en familj att utrymma sitt gömställe och får till sist Elenas eget nödmeddelande.
4. **NO MAN'S LAND** räddar Elena, patienterna och SHEPHERD:s sista sjukvårdare. Elena har preliminära data, men inget botemedel.
5. **THE LAST HOPE** ser till att datan når omvärlden. Ingen räddas över en natt, men kunskapen överlever.

Varje kapitel i REGENESIS har fem uppdrag, en ny information eller relation, en tydlig mekanisk variation och en avslutande dramatisk vändning.

---

## 11. Kapitel 1 – THE FALL [IMPLEMENTERAT, Story v1.1]

**Tagline:** *The world is ending. Stay alive.*
**Tidsläge:** Dag 0 eftermiddag – dag 1 natt
**Dramatisk fråga:** Kommer spelaren undan den första vågen?
**Källa:** `src/campaign/the-fall.ts`. All text nedan är citerad därifrån.
**Produktstatus:** Implementerad, inte fälttestad. Ändra inte uppdragens mål, längd, svårighet, zombie-AI eller radiorepliker utan särskilt beslut. Alla 50 radiorepliker är inspelade; replik-id:n är permanenta.

**Vad THE FALL är och inte är:** En överlevnadsberättelse. Den förklarar aldrig utbrottet ("People are attacking each other in the streets. Nobody knows why."). Den nämner inte REGENESIS eller Elena i någon replik, intro eller epilog; REGENESIS syns bara som storyns titel i menyerna, utan förklaring. Ordet NEXAGEN förekommer en enda gång, i epilogen, som ett oförklarat fragment.

| # | Uppdrag | Mekanik (faktisk) | Röster | Motiv | Ny information | Safehouse |
|---|---|---|---|---|---|---|
| 01 | **FIRST CONTACT** | Survival, 15:00 fast; vinst när tiden gått | WATCHTOWER | Överleva | Utbrottet; WATCHTOWER; spelaren blir Runner Seven; en grupp överlevare finns | – |
| 02 | **THE SUPPLY RUN** | Checkpoints, 3 platser i valfri ordning (2 i glesa nät, se avsnitt 21), ≈ 20 min | WATCHTOWER | Elva personer i en källare behöver medicin | Evakueringsvägarna stängs | Källaren (engångsplats) |
| 03 | **NO WAY BACK** | A till B, destination ≈ 1,5 km; genskjutning | WATCHTOWER | Vägen är bruten; sista skyddet stänger | THE WAYSTATION; **evakueringsstyrkan tystnar**; relänätet | **SH-01 THE WAYSTATION** |
| 04 | **THE LAST SIGNAL** | Checkpoints i ordning, signalöverföring vid varje (2–3 reläer), ≈ 25 min | WATCHTOWER, RAVEN TWO (slut) | Nå evakueringsstyrkan via relänätet | Ingen svarar utom RAVEN TWO | – |
| 05 | **FINAL EXTRACTION** | Survival + extraction: 30:00, helikoptern landar vid 22:00, 8 min att nå den | WATCHTOWER, RAVEN TWO | Komma ombord | Distriktet faller; spelaren räddas | – |

### 01 FIRST CONTACT
- **Intro:** "It started this afternoon. Sirens, then nothing." / "People are attacking each other in the streets. Nobody knows why." / "Then a voice breaks through the static."
- **Nyckelrepliker:** *"Any station, this is Watchtower. If you can hear me: stay outside, keep moving, and do not approach anyone."* · *"Stand by. I am picking up a second group on this channel. Survivors, not far from you."*
- **Slut (WATCHTOWER):** *"You are still on your feet. I am logging you as Runner Seven. That group needs medicine and supplies. Rest while you can."*
- **Success:** "You made it through the first night. A group of survivors needs your help." (Natten mellan dag 0 och dag 1 passerar här.)
- **Bedömning:** Fungerar. Mysteriet är exakt lagom.

### 02 THE SUPPLY RUN
- **Intro:** "Eleven people in a cellar. Two of them will not last without medicine." / "Watchtower has found three places where supplies were left behind." / "You are the only one who can still move."
- **Slut (WATCHTOWER):** *"That is all three. They will make it through the night. … Stand by, Runner. The evacuation routes are closing."*
- **Success:** "The supplies are in. The group can hold out, but the evacuation routes are closing."
- **Bedömning:** Fungerar. Etablerar att överlevare söker skydd. Känd bugg: replikerna förutsätter tre platser (avsnitt 21).

### 03 NO WAY BACK
- **Intro (v1.1):** "The evacuation road is blocked. Cars, barriers, and what is left of the people who tried." / **"One shelter is still taking people: the Waystation. Not for long."** / "And the infected have started to hunt differently."
- **Radio:** *"Runner Seven, the east road is gone. New safe zone on your map. Get there before they seal it."* · *"Two hundred metres. They are opening the gate for you."*
- **Slut (WATCHTOWER):** *"You are in. Gate is sealed. … Runner, I have lost the evacuation force. Nothing on any channel. There is an old relay network near you. It may be the last way to reach them."*
- **Success (v1.1):** **"You are inside the Waystation. But the evacuation force has gone silent."**
- **Benämning:** THE WAYSTATION är namnet; "safe zone" (radio, mål, HUD) är vad den är. Båda används och är förenliga. Radio och mål ändras inte.
- **Slutljud och bild:** dörrljud och `/img/safehouse.jpg`.

### 04 THE LAST SIGNAL
- **Intro:** "No one has heard from the evacuation force in six hours." / "An old relay network still has power. Three sites. Each has to be brought on the air by hand." / "A signal that strong will be heard by everything out there."
- **Slut:** WATCHTOWER *"Signal is out on all bands. … Wait. I have a carrier. Someone is answering."* → RAVEN TWO *"Watchtower, Raven Two. We read your signal. One aircraft, one pickup. Tell your runner to stay alive until we get there."*
- **Success:** "The signal is out. A helicopter is coming, if you can stay alive until it lands."
- **Bedömning:** Kapitlets bästa vändning. Ingen ytterligare replik får läggas här (radiokön rymmer två slutrepliker, avsnitt 18).

### 05 FINAL EXTRACTION
- **Intro:** "Raven Two is in the air. Twenty-two minutes out." / "The district is being overrun. Every street has them now." / "One aircraft. One pickup. They will not wait."
- **Nyckelrepliker:** RAVEN TWO *"Watchtower, Raven Two. Crossing the river. Ten minutes. We see fires across the whole district."*
- **Slut (RAVEN TWO):** *"We have Runner Seven. Lifting off. Watchtower, you got one out."*
- **Success:** "You are aboard. Raven Two is lifting off."

### Kapitelslut och epilog (v1.1)
Visas som text i resultatdialogen efter första vinsten i uppdrag 5, och därefter överst i kapitelvyn (THE FALL:s sida under CAMPAIGN). Inget eget ljud; helikopterljudet och RAVEN TWO:s slutreplik bär slutet.

> **THE FALL – CHAPTER COMPLETED**
> From the air the fires reach the horizon.
> Watchtower's channel is still open. Other towns are calling in.
> One call does not belong. The evacuation force, hours after she lost them: “…NEXAGEN perimeter… do not…” Then static.
> You got out. Most did not. This is not over.

**Brygga till GROUND ZERO:** RAVEN TWO sätter av Runner Seven vid en uppsamlingsplats som inte beskrivs närmare. WATCHTOWER:s kanal är fortfarande öppen, och hon har spelat upp fragmentet hundra gånger. Hon skickade SHEPHERD till byggnaden. Hon ber Runner Seven gå tillbaka ut. Var hon själv befinner sig sägs inte.

---

## 12. Kapitel 2 – GROUND ZERO [PLANERAT]

**Tagline:** *Find the missing. Uncover the truth.*
**Tidsläge:** Dag 2–4
**Dramatisk fråga:** Vad hände med SHEPHERD, och varför tystnade de?
**Safehouses:** THE WAYSTATION, THE BUNKER
**Röster:** WATCHTOWER; anonym SHEPHERD-röst (inspelningar); Elena (inspelning från 2.4). Ingen RAVEN TWO.
**Ny spelmekanik:** Evidence Log, dynamiska mål, förföljande hord, blockad.

**SHEPHERD-inspelningar:** 3–5 totalt i kapitlet, från samma anonyma operatör (2.1, 2.2 eventuellt, 2.5). Se regler i avsnitt 7.

**Avslöjandetakt:** 2.1 avslöjar bara *var* SHEPHERD var och att de varnade. NEXAGEN är fortfarande bara ett namn. REGENESIS dyker upp i 2.2; tidslinjen i 2.3; Elenas röst i 2.4; smittans början i 2.5. AI-accelerationens roll och Elenas eget ansvar sparas till NO MAN'S LAND.

### 2.1 BACK INSIDE — A till B + dynamiskt mål, cirka 15 min
- **Röster:** WATCHTOWER; SHEPHERD (inspelning).
- **Varför:** WATCHTOWER ber om hjälp, personligt: *"I sent them there, Runner. I need to know."* SHEPHERD utgick från THE WAYSTATION; det är det sista säkra ställe hon vet att de var på.
- **Händelse:** Spelaren återvänder till THE WAYSTATION, nu övergivet. SHEPHERD:s radio står kvar på loggläge och spelar upp anropet i längre form: *"Shepherd to Watchtower… at the NEXAGEN perimeter… the reception building is not safe. Do not send the buses. Do not send anyone…"* Vid ankomst ändras destinationen till SHEPHERD:s första loggade brytpunkt. En liten grupp infekterade samlas längs den ursprungliga vägen. [KRÄVER NY MEKANIK: dynamiskt mål]
- **Ny information:** SHEPHERD:s anropssignal; de nådde uppsamlingsplatsen vid NEXAGEN; byggnaden var inte säker; de varnade för att skicka fler. WATCHTOWER förklarar kort varför hon skickade dem: *"It was on the plan. A safe assembly point. I didn't question it."*
- **Framdrift:** Personligt motiv (WATCHTOWER) blir en konkret rutt att följa.
- **Skiljer sig från närliggande:** Första återbesöket av en känd plats; den enda kapitelinledningen som börjar i en plats spelaren redan känner.
- **Fynd:** E-01 *The Missing Evacuation Call*.
- **Krok:** De hade hittat något de ville rapportera.

### 2.2 THE RESEARCH LOGS — Tre checkpoints, cirka 20 min
- **Röster:** WATCHTOWER.
- **Varför:** Spelaren följer SHEPHERD:s rutt. Styrkan lämnade markerade brytpunkter, som evakueringsstyrkor gör.
- **Händelse:** Vid varje brytpunkt finns något SHEPHERD:s sjukvårdare dokumenterade eller bar med sig från evakuerad personal. WATCHTOWER läser upp en mening; resten hamnar i Evidence Log.
  1. Triageanteckning: patienter med armband märkta REGENESIS.
  2. Ett internt NEXAGEN-meddelande om ett säkerhetsstopp dag −2.
  3. Ett dokument om att stoppet hävdes i väntan på verifiering, signerat *E. Voss*.
- **Ny information:** REGENESIS finns; ett säkerhetsstopp fanns; ett namn: E. Voss. Ingen röst.
- **Framdrift:** Räddningsspåret börjar visa varför NEXAGEN-området var farligt.
- **Skiljer sig:** Lugnare tempo; det första uppdraget där fynd är kärnan.
- **Fynd:** E-02 *REGENESIS Overview*; E-03 *Safety Hold*; E-04 *Signed: E. Voss*.
- **Krok:** De evakuerade från NEXAGEN var redan sjuka när SHEPHERD tog emot dem.

### 2.3 THE PURSUIT — A till B + hordjakt, cirka 20 min
- **Röster:** WATCHTOWER.
- **Varför:** Fynden måste till THE BUNKER, ett gammalt civilförsvarsskydd där en grupp överlevare tagit skydd. Där finns en nod i sambandsnätet som kan läsa in och sända fynden till WATCHTOWER, så att hon kan jämföra dem med sina egna loggar. Spelarens första besök: platsen är trygg.
- **Händelse:** En hord följer spelarens tidigare färdväg, med tydlig förvarning i ljud och på kartan. Horden växer gradvis och har en begränsad, balanserad hastighet. [KRÄVER NY MEKANIK: förföljande hord]
- **Ny information:** WATCHTOWER ser att NEXAGEN:s interna säkerhetsstopp (E-03) är daterat dag −2, två dygn före det första fallet i staden: *"Two days before our first call. They knew."*
- **Framdrift:** Misstanken flyttas från "olycka" till "fördröjt larm".
- **Skiljer sig:** Första förföljelsen bakifrån i berättelsen; första besöket i THE BUNKER.
- **Fynd:** E-05 *Containment Timeline*.
- **Krok:** Det var inte ett naturligt utbrott.

### 2.4 THE BLOCKADE — A till B + vägval, cirka 20 min
- **Röster:** WATCHTOWER; Elena (inspelning, **första tydliga framträdandet**).
- **Varför:** Reservkraften i THE BUNKER sviktar. Utan den förlorar gruppen där sitt skydd och WATCHTOWER sin nod i nätet. En reläpunkt måste nås för att hålla sambandet. Andra besöket: platsen är hotad.
- **Händelse:** En grupp infekterade blockerar en viktig förbindelse. Minst en säker alternativ rutt måste finnas innan blockaden aktiveras. När strömmen återkommer spelar nodens meddelandelagring upp trafik som aldrig vidarebefordrats. Ett av dem är från dag −1: *"This is Dr. Elena Voss at NEXAGEN. I am calling outside company channels. Please do not use our reception building as an assembly point. I can't say more on an open line. Please call me back."* [KRÄVER NY MEKANIK: blockad]
- **Ny information:** Det fanns en varning om just mottagningsbyggnaden, och den låg i civilförsvarets eget sambandsnät.
- **Framdrift:** WATCHTOWER:s skuld blir konkret. Elena blir en människa, inte en underskrift.
- **Skiljer sig:** Hotet står framför, inte bakom; uppdraget handlar om val av väg.
- **Fynd:** E-06 *The Unanswered Call*.
- **Krok:** WATCHTOWER: *"Nobody called her back."*

### 2.5 PATIENT ZERO — Checkpoints → flykt, cirka 25 min
- **Röster:** WATCHTOWER; SHEPHERD (inspelning).
- **Varför:** SHEPHERD:s sista brytpunkt ligger vid mottagningsbyggnaden i NEXAGEN-områdets yttre gräns. Om någon lever finns spåren där.
- **Händelse:** Fiktiva zoner runt byggnaden, aldrig ett verkligt område eller en verklig byggnad. Sista loggen från SHEPHERD: de fick ut en del av personalen med hjälp av "the researcher", och skulle gå mot en vårdplats. Efter sista fyndet övergår uppdraget till flykt undan en tillströmmande hord. [KRÄVER NY MEKANIK: målbyte mitt i uppdrag]
- **Ny information:** Den sannolika tidiga smittkedjan bland personalen. SHEPHERD:s överlevande och en forskare tog sig vidare.
- **Framdrift:** Från "vad hände" till "var är de nu".
- **Skiljer sig:** Kapitlets final; kombinerar fynd och flykt.
- **Fynd:** E-07 *Initial Exposure Report*.
- **Kapitelslut:** WATCHTOWER registrerar en svag nödsändare längre bort, med en återkommande anropskod. *"That's not Shepherd's code. … But someone is still out there."*

---

## 13. Kapitel 3 – THE HUNT [PLANERAT]

**Tagline:** *They follow sound. They follow you.*
**Tidsläge:** Dag 5–7
**Dramatisk fråga:** Kan spelaren spåra nödsignalen och samtidigt skydda dem som finns på vägen?
**Safehouses:** THE TREEHOUSE, THE RANGER STATION
**Röster:** WATCHTOWER; RAVEN TWO en gång (3.4); Elena live (3.5).
**Kapitlets tema:** Ljud. Spelaren lär sig hur de infekterade reagerar på ljud (3.2), drabbas av det (3.3), använder det (3.4) och kapplöper mot det (3.5).

**Variation, så att THE HUNT inte blir fem förföljelser:**

| Uppdrag | Hotets riktning | Spelarens uppgift | Ljudets roll |
|---|---|---|---|
| 3.1 THE TRAIL | Lågt, utspritt | Söka och triangulera | Signalen är något att följa |
| 3.2 NO TURNING BACK | Bakifrån | Bära vidare | Lärdom: fältanteckningarna |
| 3.3 THE TRAP | Vid målet | Undersöka, sedan lämna | Ljudet har redan lockat dem |
| 3.4 THE GAUNTLET | Framför (blockader) | Skydda andra på avstånd | Spelaren använder ljud som verktyg |
| 3.5 THE RACE | Mot samma mål | Hinna först | En siren drar horden |

### 3.1 THE TRAIL — Tre checkpoints, cirka 20 min
- **Röster:** WATCHTOWER.
- **Varför:** Nödsändaren från GROUND ZERO är det enda spåret efter SHEPHERD och forskaren.
- **Händelse:** Tre pejlpunkter. Signalen visar sig komma från THE TREEHOUSE: en familj som hört en återkommande anropskod på en frekvens och upprepar den i hopp om att någon ska svara. WATCHTOWER får kontakt med den vuxna och förmedlar.
- **Ny information:** Koden används av någon annan, och reläas genom en kedja av repeaters.
- **Framdrift:** Spelaren hittar människor att bry sig om, och spåret blir en kedja.
- **Fynd:** E-08 *Treehouse Frequency*.
- **Relation:** Familjen i trädhuset (anonym). WATCHTOWER: *"Two kids and their father. They've been up there five days."*

### 3.2 NO TURNING BACK — Hordjakt, cirka 20 min
- **Röster:** WATCHTOWER.
- **Varför:** WATCHTOWER behöver repeaterfrekvensen från THE RANGER STATION för att följa koden.
- **Händelse:** En större hord rör sig genom området och följer spelaren bakifrån. Förföljelsen är synlig och har flera möjliga utvägar. Vid stationen: en försvunnen skogsvaktares fältanteckningar. [KRÄVER NY MEKANIK: förföljande hord]
- **Ny information:** De infekterade reagerar starkare på ljud än på synintryck; skogsvaktaren testade med brandsirenen och såg dem samlas.
- **Framdrift:** Kunskap som används i 3.4 och 4.4.
- **Fynd:** E-09 *Ranger's Field Notes*.

### 3.3 THE TRAP — Checkpoint + bakhåll, cirka 20 min
- **Röster:** WATCHTOWER.
- **Varför:** Repeaterns koordinater pekar mot en automatisk nödsignal.
- **Händelse:** Signalen har redan dragit dit infekterade. WATCHTOWER inser det för sent och säger det: *"That's on me, Runner. Get out. West or north, your call."* Uppdraget skiftar från undersökning till att lämna området genom en av två vägar.
- **Ny information:** Repeaterkedjan; koden används sannolikt av forskaren.
- **Framdrift:** WATCHTOWER:s första tydliga misstag; spåret leder mot en relästation.
- **Fynd:** E-10 *Repeater Coordinates*.

### 3.4 THE GAUNTLET — Flera blockader, cirka 25 min
- **Röster:** WATCHTOWER; RAVEN TWO (en replik).
- **Varför:** THE TREEHOUSE hotas av en hord. Familjen måste ta sig till en säkrare plats.
- **Händelse:** RAVEN TWO kan inte komma (bränsle och väder): *"Watchtower, Raven Two. Negative. Not tonight."* Spelaren aktiverar en avledande signal från ett säkert avstånd, med det som fältanteckningarna lärde, så att familjen hinner ut. Två geografiskt rimliga blockader; inga låsta återvändsgränder. [KRÄVER NY MEKANIK: blockad, ljudlockelse]
- **Ny information:** Ljud kan användas för att rädda, inte bara för att locka fara.
- **Framdrift:** Första gången spelaren räddar andra.
- **Relation:** Familjen lämnar trädhuset. **Trädhuset är nu övergivet.**

### 3.5 THE RACE — Kapplöpning, cirka 25 min
- **Röster:** WATCHTOWER; Elena (**första live-kontakten**).
- **Varför:** Relästationen i kedjan börjar ljuda; den som skickar koden är på andra sidan.
- **Händelse:** En hord dras mot signalen. Spelaren måste nå en säker aktiveringszon och få fram meddelandet innan horden tar över området. Horden har eget mål och förutsägbar väg. [KRÄVER NY MEKANIK: hord med eget mål]
- **Ny information:** Elena lever. Hon är på en provisorisk vårdstation med patienter och två av SHEPHERD:s sjukvårdare.
- **Fynd:** E-11 *Elena's Distress Message*: *"This is Elena Voss. I have nine patients and two medics from Shepherd. We cannot move them. If anyone is hearing this… please."*
- **Kapitelslut:** WATCHTOWER svarar inte direkt. Sedan: *"Two of mine. … Runner, get some rest. We're going to get them."*

---

## 14. Kapitel 4 – NO MAN'S LAND [PLANERAT]

**Tagline:** *Someone is still alive. Get them out.*
**Tidsläge:** Dag 8–10
**Dramatisk fråga:** Går det att rädda en hel grupp när de infekterade redan närmar sig?
**Safehouses:** THE FARMHOUSE, THE RANGER STATION
**Röster:** WATCHTOWER, Elena, RAVEN TWO (4.3, 4.5).
**Relationsdynamik:** WATCHTOWER och Elena talar direkt med varandra för första gången. WATCHTOWER är skeptisk och ibland skarp; Elena försvarar sig inte. Spelaren är den som gör räddningen möjlig.

### 4.1 THE CROSSING — A till B, cirka 20 min
- **Röster:** WATCHTOWER, Elena.
- **Varför:** Nå området där Elenas signal senast pejlades.
- **Händelse:** Vägen ändras när en mindre hord samlas nära första målet. Elena får kontakt och beskriver gården.
- **Ny information:** THE FARMHOUSE: befäst gård, provisorisk vårdstation.
- **Fynd:** E-12 *Farmhouse Medical Call*.

### 4.2 THE DISTRESS CALL — Tre checkpoints, cirka 20 min
- **Röster:** WATCHTOWER, Elena.
- **Varför:** Lokalisera en säker kontaktpunkt för gården.
- **Händelse:** Tre korta sändningar leder till kontaktpunkten. Elena bekräftar läget: patienter som inte kan gå, två SHEPHERD-sjukvårdare, en av dem skadad.
- **Ny information:** Vilka som finns på gården (anonymt). En större hord rör sig mot gården.
- **Fynd:** E-13 *Patient Register* (utan identifierbara personuppgifter).
- **Krok:** WATCHTOWER till Elena: *"Your building was on my evacuation plan, Doctor."* Elena: *"I know. I tried to take it off."*

### 4.3 SURROUNDED — Survival + blockad, cirka 25 min
- **Röster:** WATCHTOWER, RAVEN TWO.
- **Varför:** Gårdens tillfartsvägar är hotade; WATCHTOWER behöver tid för att hitta en väg ut.
- **Händelse:** Successivt ökande tryck, men ingen mekanik som kräver att spelaren står still i verklig fara. RAVEN TWO överflyger: *"Negative on the farm. Power lines and too many of them. I need another field."*
- **Fynd:** E-14 *Evacuation Window*.
- **Krok:** Helikoptern kan inte landa vid gården.

### 4.4 THE DIVERSION — Aktivera avledning + flykt, cirka 20 min
- **Röster:** WATCHTOWER, Elena.
- **Varför:** Horden måste bort från gården.
- **Händelse:** WATCHTOWER föreslår THE RANGER STATION:s brandsiren, som fältanteckningarna beskrev (E-09). Elena tvekar: sirenen drar dem genom andra områden. WATCHTOWER beslutar. Spelaren tar sig till en fiktiv fjärraktiveringszon, startar sirenen och lämnar området. Zombierna byter mål från gården till ljudkällan. [KRÄVER NY MEKANIK: ljudlockelse, hord med eget mål]
- **Fynd:** E-15 *Diversion Confirmed*.
- **Krok:** En kort evakueringskorridor öppnas.

### 4.5 THE RESCUE — Kapplöpning + extraction, cirka 30 min
- **Röster:** WATCHTOWER, Elena, RAVEN TWO.
- **Varför:** Korridoren är öppen en kort stund.
- **Händelse:** Spelaren måste nå en säker samlingszon före horden och bekräfta en framkomlig väg till RAVEN TWO:s nya landningsplats. De överlevandes rörelse sker i berättelsen; spelaren eskorterar inga verkliga personer. Mekaniskt närmast THE FALL 05, men målet är andras räddning, inte spelarens egen.
- **Ny information:** Elena berättar under väntan, kort, vad REGENESIS var och vad hon själv godkände: AI-urvalet var bra, och det var därför de slutade vara försiktiga. *"The models were right about almost everything. We stopped checking the rest."*
- **Fynd:** E-16 *Elena's Preliminary Results*.
- **Kapitelslut:** Elena, patienterna och SHEPHERD:s sjukvårdare når säkerhet. **SHEPHERD-tråden avslutas.** Elena har preliminära data som kan hjälpa andra forskare att förstå hur sjukdomsförloppet kan bromsas, men ingen behandling.

---

## 15. Kapitel 5 – THE LAST HOPE [PLANERAT]

**Tagline:** *Save the research. Give them a chance.*
**Tidsläge:** Dag 11–12
**Dramatisk fråga:** Kan kunskapen nå omvärlden innan sambandet försvinner?
**Safehouses:** THE BUNKER, THE ROOFTOP
**Röster:** WATCHTOWER, Elena, RAVEN TWO (5.3, 5.5); anonym forskarröst (5.4).
**Finalens princip:** Berättelsens klimax är en lyckad överföring, inte ännu en identisk helikopterfinal.

### 5.1 THE NETWORK — Tre checkpoints, cirka 20 min
- **Röster:** WATCHTOWER.
- **Varför:** THE BUNKER har förlorat delar av reservkraften. Tre virtuella reläer behövs för att nå THE ROOFTOP. Tredje besöket: gruppen i THE BUNKER flyttar till THE ROOFTOP när kedjan står, och **THE BUNKER överges**.
- **Händelse:** Checkpointkedja med gradvis återkommande radiotrafik.
- **Fynd:** E-17 *Network Restoration*.
- **Relation:** WATCHTOWER får kontakt med flera avskurna grupper; hon har blivit nav för ett litet nät av överlevare. Var hon sänder ifrån sägs fortfarande inte.

### 5.2 THE SWARM — Hordjakt, cirka 25 min
- **Röster:** WATCHTOWER.
- **Varför:** En sista anslutningskod måste levereras till THE ROOFTOP:s sändarzon.
- **Händelse:** Tydligt förvarnad förföljelse med alternativa rutter; den största horden hittills.
- **Fynd:** E-18 *Uplink Key*.
- **Krok:** Sändningsfönstret är kort.

### 5.3 THE LAST ROUTE — Blockad + vägval, cirka 25 min
- **Röster:** WATCHTOWER, RAVEN TWO.
- **Varför:** Flera förbindelser mot THE ROOFTOP är blockerade.
- **Händelse:** WATCHTOWER föreslår en väg men spelaren väljer själv utifrån kartan. Blockader prövas mot verkligt vägnät; enklare uppdragsform om inga rimliga omvägar finns. RAVEN TWO: *"I can get you out after. Not before. They'll hear me."*
- **Fynd:** E-19 *Final Route Confirmed*.

### 5.4 THE TRANSMISSION — Överföring + närmande horder, cirka 25 min
- **Röster:** WATCHTOWER, Elena; anonym forskarröst (en replik).
- **Varför:** Elenas data ska till ett forskarnätverk utanför regionen.
- **Händelse:** Spelaren aktiverar två reläpunkter och håller sig sedan inom en säker, generöst definierad GPS-zon medan överföringen pågår. Horder närmar sig, men spelaren kan avbryta och återuppta sändningen. Ingen verklig station behöver beträdas. Mekaniskt en utbyggnad av THE FALL 04:s signalöverföring [IMPLEMENTERAT i grundform].
- **Fynd:** E-20 *Data Received*. Anonym röst: *"Receiving. … Complete. We have it."*
- **Krok:** Forskarna bekräftar mottagning, men det finns ännu ingen behandling. Elena: *"It's not a cure. It's a head start. This time, use it slowly."*

### 5.5 DAWN — Slutlig flykt/överlevnad, cirka 30 min
- **Röster:** WATCHTOWER, RAVEN TWO.
- **Varför:** Den sista lokala länken fallerar; de infekterade samlas kring sändaren.
- **Händelse:** Spelaren tar sig till en säker utgångszon. Kombination av förföljelse och vägval; ingen ny huvudmekanik. RAVEN TWO hörs på väg in; **den avgörande vinsten är redan uppnådd**.
- **Omnämnanden:** WATCHTOWER nämner kort att familjen från THE TREEHOUSE har hört av sig, och att SHEPHERD:s sjukvårdare hjälper till i nätet.
- **Slutscen:** Soluppgång, avtagande radiobrus, en kort bekräftelse från forskarnätverket. RAVEN TWO hörs men syns inte; bilden visar THE ROOFTOP i gryningsljus.
- **Sista replik, WATCHTOWER:** *"We can't undo what happened. But maybe we can stop it from happening again."*

**Slutets innebörd:** Mänskligheten är inte räddad över en natt. Men människor har räddats, och kunskap som annars skulle gått förlorad finns kvar.

---

## 16. Ledtrådar och avslöjanden

### Evidence Log: 20 fynd [PLANERAT, KRÄVER NY MEKANIK]

| ID | Uppdrag | Fynd | Form | Berättelsefunktion |
|---|---|---|---|---|
| E-01 | 2.1 | The Missing Evacuation Call | SHEPHERD-inspelning | Personligt motiv; NEXAGEN-spår |
| E-02 | 2.2 | REGENESIS Overview | Text | Vad företaget utvecklade |
| E-03 | 2.2 | Safety Hold | Text | Tidig varning |
| E-04 | 2.2 | Signed: E. Voss | Text | Elenas namn, utan röst |
| E-05 | 2.3 | Containment Timeline | Text + WATCHTOWER | Fördröjt larm: stoppet dag −2 mot första fallet dag 0 |
| E-06 | 2.4 | The Unanswered Call | Elena-inspelning | Elenas första framträdande; WATCHTOWER:s skuld |
| E-07 | 2.5 | Initial Exposure Report | Text + SHEPHERD-inspelning | Utbrottets sannolika början; överlevare tog sig vidare |
| E-08 | 3.1 | Treehouse Frequency | WATCHTOWER | Familjen i trädhuset; repeaterkedjan |
| E-09 | 3.2 | Ranger's Field Notes | Text | De infekterades ljudbeteende |
| E-10 | 3.3 | Repeater Coordinates | Text | Spår mot Elena |
| E-11 | 3.5 | Elena's Distress Message | Elena live | Nytt räddningsmål |
| E-12 | 4.1 | Farmhouse Medical Call | Elena live | Vårdstationen |
| E-13 | 4.2 | Patient Register | Text, anonymiserad | Människor i fara |
| E-14 | 4.3 | Evacuation Window | WATCHTOWER | Tidspress |
| E-15 | 4.4 | Diversion Confirmed | WATCHTOWER | Räddningskorridor öppnas |
| E-16 | 4.5 | Elena's Preliminary Results | Text + Elena | Hopp om fortsatt forskning; AI-accelerationens roll |
| E-17 | 5.1 | Network Restoration | WATCHTOWER | Kommunikation återupprättas |
| E-18 | 5.2 | Uplink Key | Text | Slutlig sändning möjlig |
| E-19 | 5.3 | Final Route Confirmed | WATCHTOWER | Sista vägen fram |
| E-20 | 5.4 | Data Received | Anonym forskarröst | Berättelsens centrala seger |

**UI-regel:** Under spel visas fyndets namn, en mening och eventuell kort radioröst. Full text, ljudarkiv och tidslinje finns mellan uppdragen. Ingen spelare ska behöva läsa längre dokument under gång eller cykling.

### Avslöjandeplan: vad spelaren vet efter varje kapitel

| Efter | Spelaren vet | Spelaren vet inte |
|---|---|---|
| THE FALL | Utbrottet är oförklarat. Evakueringsstyrkan försvann. Ett anrop nämnde "NEXAGEN perimeter". | Vad NEXAGEN är. Allt om REGENESIS, Elena, AI. |
| GROUND ZERO | Mottagningsbyggnaden var en smitthärd; NEXAGEN, REGENESIS, säkerhetsstoppet dag −2; att Elena varnade för byggnaden och inte fick svar; ungefär hur smittan började. SHEPHERD:s överlevande lever kanske. | Var Elena är. AI:s roll. Elenas eget ansvar. Var WATCHTOWER finns. |
| THE HUNT | Ljudets betydelse. Elena lever och var hon finns. | AI:s roll. Om det finns hopp. |
| NO MAN'S LAND | Elenas ansvar; att AI-tempot fick säkerheten att släppas; att det finns preliminära data. SHEPHERD-tråden är avslutad. | Om datan når fram. |
| THE LAST HOPE | Datan har nått fram. Ingen behandling ännu. | – |

---

## 17. Återanvändbara spelmekaniker

| Mekanik | Definition | Status | Viktiga designkrav |
|---|---|---|---|
| Survival | Överlev under tidsfönster | [IMPLEMENTERAT] THE FALL 01 (`winOnTimeout`) | Tydligt mål, rimlig intensitet |
| Extraction | Överlev tills helikoptern landar, nå den | [IMPLEMENTERAT] THE FALL 05 | Landningsplats på nätet; `extractionRetry` |
| A to B | Nå en GPS-destination | [IMPLEMENTERAT] THE FALL 03 | Flera tillåtna rutter när möjligt |
| Checkpoints | Besök geografiska zoner, i valfri eller fast ordning | [IMPLEMENTERAT] THE FALL 02 (`anyOrder`), 04 | Automatisk registrering; 2–3 mål beroende på nät |
| Transmission | Stanna inom en zon medan en signal sänds; paus utan förlust | [IMPLEMENTERAT] THE FALL 04 | Radie ≥ 50 m, GPS-tolerans, paus/återupptagning |
| Genskjutning | Infekterade läser rörelseriktning och skär av | [IMPLEMENTERAT] `interceptModel: "track"` | Kan luras genom riktningsbyte |
| Intensitet | Fartsteg över speltiden | [IMPLEMENTERAT] THE FALL 05 | Förvarnas i radion |
| Ljud lockar | Extra infekterade när en sändning börjar | [IMPLEMENTERAT] `transmitSpawn` | Alltid på säkert spawnavstånd (≥ 300 m) |
| Pursuit | Hord följer spelarens färdväg | [KRÄVER NY MEKANIK] | Ingen orättvis spawn nära spelaren; förvarning |
| Blockade | Infekterade samlas vid ett vägavsnitt | [KRÄVER NY MEKANIK] | Säker och rimlig alternativ rutt måste finnas |
| Race | Spelare och hord mot samma destination | [KRÄVER NY MEKANIK] | Horden lockas av ljud/händelse, inte planering |
| Sound Lure | Spelaren startar en ljudkälla som drar horden | [KRÄVER NY MEKANIK] | Aktivering på avstånd; ingen verklig anläggning |
| Dynamic Events | Fynd eller radiobesked ändrar mål/hotbild | [KRÄVER NY MEKANIK] | Tydlig orsak och UI-återkoppling |
| Safehouse Arrival | GPS-ankomst utlöser filmisk scen | [KRÄVER NY MEKANIK] (i dag endast slutbild + dörrljud) | Kräver inte tillträde till verklig byggnad |
| Evidence Log | Arkiverar fynd och radiomeddelanden | [KRÄVER NY MEKANIK] | Lätt att nå mellan uppdragen |

Free Play har sedan #60 en zombie-AI med roller (förföljare och genskjutare, `src/engine/ai/roles.ts`). Pröva om den kan bära Pursuit innan ny kod skrivs.

**Teknisk arkitekturprincip:** Uppdragen beskrivs deklarativt som sekvenser av mål, triggers, radiorepliker, bildscener och fiendehändelser (så är THE FALL byggd: `src/campaign/types.ts`). Undvik specialkod för enskilda uppdrag. Granska befintliga funktioner i koden innan nya mekaniker planeras som färdiga.

---

## 18. Radio, ljud och filmiska bilder

**Radio är huvudkanalen.** WATCHTOWER förklarar mål, RAVEN TWO markerar sällsynta räddningsmöjligheter, Elena ger berättelsen tyngd och kunskap. Radiorasp, korta tystnader och distinkta miljöljud förstärker. Undvik oavbrutet prat.

**Skrivregler** (gäller redan i THE FALL):

- En replik ska göra minst ett av tre jobb: förmedla uppdragsinformation, avslöja karaktär eller öka spänningen.
- Kort, enkelt, procedurmässigt. Anropssignaler, inga tal, inga skämt.
- Högst 40 ord (testas i `campaign-progress.test.ts`). Repliken visas också som text under rörelse och måste kunna läsas med en blick.
- WATCHTOWER höjer bara rösten när spelaren är på väg att bli fångad.
- Beskriv vad de infekterade gör, aldrig vad de tänker (avsnitt 9).

**Produktionsregler för röster [IMPLEMENTERAT i THE FALL]:**

- En MP3 per replik: `public/campaign/<kapitel-id>/voice/<replik-id>.mp3`. **Replik-id:n är permanenta;** byt aldrig namn på ett inspelat id.
- Manus genereras ur definitionerna (`docs/campaign/<kapitel-id>-voice-script.csv`); röstmanifestet med `npm run campaign:voice`. CI kör `campaign:voice -- --check`.
- Ändras texten i en inspelad replik måste den spelas in igen (`npm run campaign:voice:generate -- --only <id> --force`), annars säger ljudet något annat än texten.
- Intro, success-text och epilog är bara text. De kan ändras utan att något spelas in igen.
- **Radiokön rymmer en replik som spelas och en som väntar.** Ett uppdragsslut får därför ha **högst två** slutrepliker i följd; en tredje tränger undan den andra.

**Filmiska bilder.** Korta stillbilder, aldrig något som kräver att spelaren tittar på skärmen under rörelse: kapitelomslag, uppdragsbild (kort, briefing, intro, resultat), slutbild (helikopter, safehouse). Planerat: Safehouse-ankomst, återbesök av övergiven plats, fynd, evakuering, sändning. Håll gemensam färg- och ljussättning med THE FALL: skymning, rött ljus, regn, eld.

**Dramaturgisk rytm per uppdrag:** Briefing (15–30 s) → rörelse och första komplikation → mittpunkt med fynd eller ny information → eskalering → tydlig avslutning och kort efterspel. Exakta tider testas i fält.

---

## 19. Misslyckande, progression och återspelbarhet

- **THE FALL [IMPLEMENTERAT]:** Vinst låser upp nästa uppdrag. Fångad eller tiden ute räknas som ett misslyckat försök; inget tidigare framsteg går förlorat. Omspel tar aldrig bort något. Sparas lokalt (`outbreak.campaign.the-fall`). Se `docs/CAMPAIGN-THE-FALL.md` §5.
- I nya kapitel leder misslyckade kapplöpningar helst till en **alternativ gren inom samma uppdrag** eller ett begripligt omförsök, inte till godtycklig permanent karaktärsdöd.
- Safehouses kan bli hotade eller övergivna som **författade berättelsehändelser**. En spelare ska aldrig förlora en karaktär eller en plats för att GPS-signalen tappades.
- Ledtrådar ska kunna återläsas. Spelaren ska inte behöva minnas detaljer från ett tidigare träningspass.
- Kapitlen är linjära i version 1. Eventuella förgreningar är lokala och återgår till huvudberättelsen.

---

## 20. GPS-säkerhet och geografisk trovärdighet

- Inga uppdrag får kräva intrång, klättring, vägkorsning på olämpligt ställe, verklig bunkeråtkomst eller interaktion med främlingar.
- Kartgenererade mål placeras på lagliga, lämpliga och åtkomliga gång- eller cykelvägar enligt valt spelläge. Där underlaget är osäkert väljer systemet en enklare uppdragsform. (THE FALL: mål snappas till nätet; uppdrag 3 avstår hellre än lägger ett orimligt mål.)
- Inga fiendehändelser får uppmuntra panikartad sprint i trafik. Hot ska vara balanserade för taktiska vägval och tillåta reträtt.
- GPS-drift får inte orsaka orättvis förlust vid sändning eller Safehouse-ankomst. (THE FALL 04: zonradie ≥ 50 m, hysteres 10 m, opålitlig GPS varken räknar eller tappar signal.)
- Inga överraskande visuella interaktioner under rörelse; använd ljud och tydliga pauspunkter.
- Spelaren ska alltid kunna pausa, avbryta och prioritera verklig säkerhet. (THE FALL: paus och QUIT finns; GPS-bortfall fryser klocka, zombier och berättelse.)
- Fiktiva platser (NEXAGEN-området, Safehouses) är **aldrig** verkliga platser på kartan.
- Cykelspel kräver separat validering. Kapitlen är i första hand **on foot** tills annat testats.

---

## 21. Implementationsstatus och utvecklingsordning

### Status

| Del | Status |
|---|---|
| THE FALL, 5 uppdrag, 50 inspelade repliker, 6 bilder, epilog | [IMPLEMENTERAT] Story v1.1. Ej fälttestad. |
| GROUND ZERO, THE HUNT, NO MAN'S LAND, THE LAST HOPE | [PLANERAT] Ingen kod, inga bilder, inga ljud. Visas i spelet bara som namn under "Coming later" på THE FALL:s sida. |
| Story-nivån REGENESIS | [IMPLEMENTERAT] `src/campaign/stories.ts`: storyns titel och kapitelordning. Spelbara kapitel är `CampaignDef`; planerade kapitel är bara namn. |
| Evidence Log, Safehouse Arrival, Dynamic Events, Pursuit, Blockade, Race, Sound Lure | [KRÄVER NY MEKANIK] |

### Kända problem

- **Två eller tre checkpoints i THE FALL 02 och 04.** I glesa vägnät kan uppdragen få två mål (`minCount: 2`), men replikerna förutsätter tre ("Two to go" följt av "That is all three"; "Three relay sites on your map"). Dokumenterad som separat bugg: [`docs/BUGG-THE-FALL-TVA-CHECKPOINTS.md`](BUGG-THE-FALL-TVA-CHECKPOINTS.md). Åtgärdas inte inom Story v1.1.

### Utvecklingsordning

**Fas A: Verifiera grunden**
1. Fälttesta THE FALL utan att samtidigt skriva om dess kärnmekanik. Logga hur ofta uppdrag 2 och 4 får två mål.
2. Inventera nuvarande slutbilder, radiotriggers och progression (gjort för THE FALL i v2.2).
3. Testa tre fristående prototyper: Pursuit, Blockade, Race. Pröva Free Plays roll-AI som grund för Pursuit.

**Fas B: Bygg berättelsesystemen**
4. Välj ElevenLabs-röst för Elena och högst två anonyma röster.
5. Implementera generell Safehouse Arrival med bild, ljud, radioreplik och återbesöksstatus.
6. Implementera Evidence Log och Dynamic Events.
7. Producera GROUND ZERO som första nya fullständiga kapitel.

**Fas C: Utvärdera och expandera**
8. Fälttesta geografisk variation, särskilt i glest respektive tätt vägnät.
9. Revidera uppdragslängder och svårighetskurva.
10. Producera THE HUNT, NO MAN'S LAND och THE LAST HOPE först när de centrala mekanikerna fungerar.

### Produktionsunderlag för GROUND ZERO (preliminärt)

| Typ | Behov |
|---|---|
| Bilder | Kapitelomslag; fem uppdragsbilder (övergiven WAYSTATION med radion kvar; brytpunkt med triageanteckningar och REGENESIS-armband; hord på en väg i skymning; THE BUNKER med sviktande nödbelysning; NEXAGEN:s mottagningsbyggnad bakom ett stängsel i dimma, utan logotyp); Safehouse-bilder för THE WAYSTATION (övergiven variant) och THE BUNKER (trygg och hotad variant) |
| Röster | WATCHTOWER ≈ 40–50 repliker (befintlig röst); SHEPHERD, 3–5 inspelningar från en anonym operatör (en delad anonym röst, avsnitt 6); Elena 1–2 inspelningar (2.4, eventuellt 2.5); RAVEN TWO inga |
| Ljud | Miljö för övergiven vägstation; THE BUNKER med generatorbrum och strömavbrott; reläpåslag; hordljud som närmar sig bakifrån; inspelningsljud (bandbrus, avbrott); ljudsignal för nytt fynd |
| Mekanik | Evidence Log, Dynamic Events, Pursuit, Blockade, målbyte mitt i uppdrag (se avsnitt 17) |

---

## 22. Beslut och öppna frågor

### Beslut i v2.2 (besvarar öppna frågor i v2.0)

| Fråga i v2.0 | Beslut |
|---|---|
| Behöver räddningsgruppen en namngiven medlem som spelaren mött i THE FALL? | Nej. Gruppen är evakueringsstyrkan SHEPHERD, som spelaren redan väntat på i THE FALL. Den har en anropssignal och anonyma röster, ingen namngiven medlem. |
| Ska Maya och Leo få en avslutande radiocameo? | Maya och Leo finns inte längre. WATCHTOWER nämner familjen från THE TREEHOUSE i 5.5. |
| Ska RAVEN TWO synas i slutscenen eller bara höras? | Bara höras. Slutet betonar överföringen, inte helikoptern. |
| Behöver THE HUNT fler varierade moment? | Variationen är nu definierad per uppdrag (avsnitt 13). Fältpröva innan fler moment läggs till. |

### Öppna frågor

- Ska THE FALL 03:s radiorepliker någon gång spelas in igen med namnet Waystation? Inte nödvändigt: texten namnger platsen och radion beskriver den.
- Ska SHEPHERD:s anropssignal höras redan i THE FALL? Bara om GROUND ZERO:s fälttest visar att kopplingen inte uppfattas. Det kräver ny inspelning av en befintlig replik.
- ElevenLabs-röst för Elena: välj i Fas B, med lyssningstest mot WATCHTOWER så att rösterna inte förväxlas.
- Var befinner sig WATCHTOWER? Medvetet okänt. Avgör senast under produktionen av THE LAST HOPE om platsen ska avslöjas; till dess får ingen replik eller bild placera henne.

---

## 23. Ändringslogg

**v2.3 (2026-11-16)** jämfört med v2.2:

- Huvudtiteln bytt från OUTBREAK: THE ACCELERATION till **OUTBREAK: REGENESIS**. Beslut: berättelsen döps efter NEXAGEN:s behandling, som också blir titeln på spelets första story. Temat AI-accelererad forskning och bristande säkerhetsarbete är oförändrat.
- Hierarkin Spel → CAMPAIGN (spelläge) → STORY → CHAPTER → MISSION fastställd (avsnitt 0). "Kampanj 1–5" heter nu "kapitel 1–5" i hela dokumentet. Antalet kapitel och uppdrag är specifikt för REGENESIS.
- Ingen ändring av berättelse, roller, tidslinje, radiorepliker, Evidence Log, uppdrag eller slut. Ändringsloggen för v2.2 nedan står kvar med sin ursprungliga ordalydelse ("kampanjer").
- Filnamnet behålls (`OUTBREAK_STORY_BIBLE_V2_2.md`). v2.0 i arkivet behåller titeln THE ACCELERATION som historik.

**v2.2 (2026-11-16)** jämfört med v2.0:

- Rollbesättningen reducerad till tre återkommande talande huvudroller. Borttaget: WATCHTOWER:s civila namn "Morgan", Maya, Leo, Jonas, Sara. Regler för anonyma röster tillagda (avsnitt 6).
- Röstproduktion: karaktärsnamn skiljs från ElevenLabs-röstnamn. "Morgan" är RAVEN TWO:s röstmodell.
- Spelarens anropssignal RUNNER SEVEN dokumenterad.
- Räddningsgruppen ersatt av den befintliga evakueringsstyrkan, nu med anropssignal SHEPHERD och förklarad koppling till NEXAGEN.
- Slutjustering före merge: SHEPHERD är uttryckligen en enhet, inte en huvudroll (3–5 inspelningar från en anonym operatör i GROUND ZERO). SHEPHERD skickades till NEXAGEN:s medicinska mottagnings- och logistikbyggnad, registrerad som möjlig säker uppsamlingsplats i regionens beredskapsplan; ingen utanför NEXAGEN kände till kopplingen. NEXAGEN:s påstådda evakueringsbegäran dag −1 struken. THE BUNKER är ett fristående Safehouse (besöks, hotas, överges), inte WATCHTOWER:s post; WATCHTOWER:s position är okänd. Berörda uppdrag: 2.1, 2.3, 2.4, 2.5, 4.2, 5.1; THE BUNKER struken ur THE HUNT.
- THE FALL beskriven efter koden, med faktiska slutrepliker och epilog. v2.0:s påhittade slutrepliker ("You're safe now. Get some rest." / "We've lost contact with three more evacuation zones.") strukna.
- THE WAYSTATION placerad i THE FALL 03 i stället för som antydan i 02.
- Tidslinje: THE FALL dag 0–1; övriga kampanjer förskjutna en dag.
- Zombiernas genskjutning beskriven som instinkt i linje med implementerad AI.
- Elenas introduktion stegvis och dokumenterad; första röstframträdandet flyttat till GROUND ZERO 2.4.
- Alla 25 uppdrag kompletterade med röster, motiv, ny information, framdrift och skillnad mot närliggande uppdrag.
- Implementationsstatus markerad per avsnitt; känd bugg (två checkpoints) dokumenterad.
- Evidence Log: E-01, E-04, E-06, E-09 omdöpta efter nya källor.

**v2.0** (arkiverad): [`docs/story/archive/OUTBREAK_STORY_BIBLE_V2_1.md`](story/archive/OUTBREAK_STORY_BIBLE_V2_1.md).

---

## 24. Sammanfattning för utvecklingsteamet

**Bygg inte ett nytt militärspel. Bygg ett bättre Outbreak.**

REGENESIS fem kapitel och 25 uppdrag knyts samman av ett AI-accelererat medicinskt experiment, tre återkommande röster (WATCHTOWER, RAVEN TWO, Elena Voss), spelaren RUNNER SEVEN, en försvunnen evakueringsstyrka och sex fiktiva Safehouses. Zombier är det enda aktiva kartbaserade hotet. Uppdragen får variation genom jakt bakifrån, blockader, kapplöpningar, ljud, ledtrådar och dynamiska händelser. THE FALL bevaras. Berättelsen växer från egen överlevnad till ansvar för andra, och slutar med att kunskap förs vidare, inte med ett osannolikt omedelbart botemedel.

**Överordnat designkriterium:** Varje större berättelsehändelse ska, när det är möjligt, märkas i spelarens faktiska GPS-upplevelse.
