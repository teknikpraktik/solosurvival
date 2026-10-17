# Regelpåverkan Etapp 3 (testområden Skutberget, I2-skogen, Sörmon)

Data: `fixtures-osm-pbf` (OSM-länsextrakt). Längder i km längs hela ways som rör rutan (ca 3×3 km). Jämför Etapp 2.5-regler (`lib/decide-way-2.5.ts`) med nuvarande `decideWay` och hazard-delning.

## 1. Andel utesluten stig per aktivitet (andel av längden på path/footway/track/cycleway/service/residential/living_street/unclassified/pedestrian/bridleway)

| Aktivitet | Totalt km | Uteslutet 2.5 | Uteslutet nu | Tillkommit sedan 2.5 |
|---|---|---|---|---|
| walk | 261.3 | 4.0 % | 7.6 % | 3.6 % |
| run | 261.3 | 4.0 % | 7.6 % | 3.6 % |
| mtb | 261.3 | 8.1 % | 11.9 % | 3.8 % |

## 2. Orsaker (andel av total längd; "nya" = uteslutna nu men inte med 2.5-reglerna)

**walk**

| Regel | Uteslutet km | Andel | Varav nytt sedan 2.5 |
|---|---|---|---|
| service | 10.1 | 3.9 % | 0.0 km |
| visibility | 9.3 | 3.5 % | 9.3 km |
| cycleway-no-foot | 0.2 | 0.1 % | 0.2 km |
| access | 0.2 | 0.1 % | 0.0 km |

**run**

| Regel | Uteslutet km | Andel | Varav nytt sedan 2.5 |
|---|---|---|---|
| service | 10.1 | 3.9 % | 0.0 km |
| visibility | 9.3 | 3.5 % | 9.3 km |
| cycleway-no-foot | 0.2 | 0.1 % | 0.2 km |
| access | 0.2 | 0.1 % | 0.0 km |

**mtb**

| Regel | Uteslutet km | Andel | Varav nytt sedan 2.5 |
|---|---|---|---|
| service | 10.1 | 3.9 % | 0.0 km |
| visibility | 9.3 | 3.5 % | 9.2 km |
| foot-only | 7.1 | 2.7 % | 0.0 km |
| bicycle | 3.6 | 1.4 % | 0.0 km |
| mtb-scale | 0.8 | 0.3 % | 0.8 km |
| access | 0.2 | 0.1 % | 0.0 km |

## 3. Sammanhängande delar (antal komponenter / total km / största km / största andel)

| Område | Aktivitet | Gamla regler, ingen delning | Nya regler, ingen delning | Nya regler + hazard-delning (spelets nät) | Hazard-stubbar |
|---|---|---|---|---|---|
| skutberget | walk | 7 / 52.1 / 47.7 / 91.6 % | 7 / 50.2 / 42.6 / 84.9 % | 9 / 50.2 / 42.2 / 84.1 % | 34 |
| skutberget | run | 7 / 52.1 / 47.7 / 91.6 % | 7 / 50.2 / 42.6 / 84.9 % | 9 / 50.2 / 42.2 / 84.1 % | 34 |
| skutberget | mtb | 8 / 49.3 / 44.8 / 90.9 % | 8 / 47.4 / 39.7 / 83.9 % | 10 / 47.4 / 39.3 / 83.0 % | 32 |
| i2-skogen | walk | 6 / 116.3 / 106.5 / 91.6 % | 8 / 109.4 / 99.4 / 90.9 % | 10 / 109.4 / 92.8 / 84.8 % | 26 |
| i2-skogen | run | 6 / 116.3 / 106.5 / 91.6 % | 8 / 109.4 / 99.4 / 90.9 % | 10 / 109.4 / 92.8 / 84.8 % | 26 |
| i2-skogen | mtb | 6 / 113.0 / 103.9 / 92.0 % | 8 / 105.7 / 96.5 / 91.4 % | 11 / 105.7 / 88.5 / 83.8 % | 27 |
| sormon | walk | 2 / 82.7 / 82.4 / 99.7 % | 2 / 81.9 / 81.7 / 99.7 % | 3 / 81.9 / 81.3 / 99.2 % | 8 |
| sormon | run | 2 / 82.7 / 82.4 / 99.7 % | 2 / 81.9 / 81.7 / 99.7 % | 3 / 81.9 / 81.3 / 99.2 % | 8 |
| sormon | mtb | 2 / 78.0 / 77.7 / 99.7 % | 2 / 77.2 / 77.0 / 99.7 % | 3 / 77.2 / 76.5 / 99.1 % | 8 |

## 4. Vad delningen stoppar (hazard-stubbar per typ som stigen möter)

| Aktivitet:typ | Antal stubbar |
|---|---|
| mtb:järnväg | 2 |
| mtb:vatten:stream | 1 |
| mtb:väg:tertiary | 32 |
| mtb:väg:trunk | 4 |
| run:järnväg | 2 |
| run:vatten:stream | 1 |
| run:väg:tertiary | 37 |
| run:väg:trunk | 4 |
| walk:järnväg | 2 |
| walk:vatten:stream | 1 |
| walk:väg:tertiary | 37 |
| walk:väg:trunk | 4 |
