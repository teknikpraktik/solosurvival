# Regelpåverkan på ruttäckning (Etapp 3)

Fullständiga tabeller: `experiments/data/results-rule-impact.md` (genereras av `npx tsx experiments/data/rule-impact.ts`). Data: OSM-länsextrakt, de tre testområdena (Skutberget, I2-skogen, Sörmon), 261 km path/track/service-liknande ways. Jämförelse mot Etapp 2.5-reglerna (frysta i `experiments/data/lib/decide-way-2.5.ts`).

## Utesluten andel (av längd)
| Aktivitet | 2.5 | Nu | Tillkommit |
|---|---|---|---|
| Walk | 4,0 % | 7,6 % | 3,6 pp |
| Run | 4,0 % | 7,6 % | 3,6 pp |
| MTB | 8,1 % | 11,9 % | 3,8 pp |

## Orsaker
- **Nya bortfall:** `trail_visibility` bad/horrible/no = 9,3 km (3,5 % av längden, i stort sett hela tillskottet). `cycleway-no-foot` 0,2 km, `mtb:scale` ≥ 3 0,8 km (MTB). Ford, `sac_scale` och utökade åtkomstvärden gav ingen mätbar längd i dessa områden.
- **Gamla bortfall (oförändrade):** `service` (uppfarter/p-gångar) 3,9 %; för MTB dessutom gångväg utan cykeltillstånd 2,7 % och `bicycle=no` 1,4 %; `access` 0,1 %.

## Vägkorsningar och sammanhang
Stigar delas där de delar nod med större väg (≤ tertiary), järnväg eller å/älv/bäck. Per aktivitet och område ger det 8–37 stubbar (Sörmon 8, I2-skogen 26–27, Skutberget 32–34), nästan uteslutande tertiary (37) och trunk (4); järnväg 2 och bäck 1. Största sammanhängande delens andel av nätet sjunker 0–7 procentenheter (I2-skogen Walk 90,9 → 84,8 %, Skutberget 84,9 → 84,1 %, Sörmon 99,7 → 99,2 %). Delningen splittrar alltså inte nätet i obrukbara fragment, men tar bort kopplingar över vägar (främst I2-skogen).

## Blockeras säkra och lagliga passager i onödan?
- Från taggarna går det **inte** att skilja ett säkert, markerat övergångsställe från en farlig korsning: tiles innehåller inga nodtaggar (`highway=crossing`, `traffic_signals`). Därför behandlas alla delade noder som farliga. Detta är avsiktligt konservativt och ändras inte.
- **Möjlig förbättring med stöd, kräver ny data:** ta med nodtaggar för korsningar i tiles och tillåt passage endast vid explicit `crossing=traffic_signals/marked` på tertiary eller lägre. Inte genomfört: kräver datamodellsändring och fältbedömning; passage av vägar tillåts aldrig av spelet i dag.
- **`trail_visibility=bad` (9,3 km):** nästan alla träffar är lätta MTB-stigar (mtb:scale 0–2) i Skutberget. Regeln bygger på orienterbarhet/skaderisk, inte på laglighet eller korsningsfara, och stödet för att utesluta "bad" respektive tillåta det är otillräckligt. **Ingen ändring gjord**; utvärdera i fält (följbarhet för Walk/Run/MTB). Om fältdata visar att "bad" fungerar kan den tillåtas för Walk medan "horrible/no" förblir uteslutet.
- Cykelbana utan `foot` (0,2 km) och `access`-värden är försumbara och behålls konservativt.

Slutsats: ingen regel ändrades för att få fler rutter. Kvarstående förslag (nodtaggar för korsningar, `trail_visibility=bad`) kräver ny data respektive fältunderlag.
