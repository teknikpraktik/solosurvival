# Genererade resultat: spellägen (etapp 2.5)

Genereras av `experiments/routes/summarize.ts` från `results/*.jsonl` (ej incheckade; återskapas med `experiments/routes/run-all.sh`). Alla körningar: verkliga OSM-nät (Värmland-extrakt 2026-10-17), samma motor för alla lägen.

Kolumner: giltig rutt = andel scenarier där generatorn gav minst ett förslag; tidsgräns ute = ej infekterad men målet inte nått; blockerade vägval = andel vägval där den mest målinriktade vägen nåddes av en zombie före spelaren; avvikelse = andel vägval där boten valde annat än rutten. 'gången/ruttlängd' är ogiltig för promenad (motorns distansräkning ignorerar steg < 0,5 m).

## M1 – tre lägen × bot

| mode · bot | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |
|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|
| escape · follower | 270 | 100 % | 49 [43–54] | 51 | 0 | 18.8 | 44 % | – | – | 0.49 |
| escape · planner | 270 | 100 % | 64 [58–69] | 32 | 4 | 18.9 | 45 % | 11.2 | 13.7 | 0.57 |
| mission · follower | 270 | 100 % | 31 [26–37] | 69 | 0 | 30.8 | 46 % | – | – | 0.36 |
| mission · planner | 270 | 100 % | 45 [39–51] | 53 | 2 | 31.1 | 47 % | 11.7 | 14.7 | 0.51 |
| survival · follower | 270 | 100 % | 47 [42–53] | 47 | 5 | – | – | 0.0 | 0.0 | – |
| survival · planner | 270 | 100 % | 44 [38–50] | 47 | 9 | – | – | 0.8 | 0.9 | – |

## M1 – läge × difficulty (planerare)

| mode · difficulty | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |
|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|
| escape · easy | 90 | 100 % | 86 [77–91] | 13 | 1 | 18.9 | 43 % | 4.2 | 5.8 | 0.67 |
| escape · hard | 90 | 100 % | 46 [36–56] | 48 | 7 | 18.8 | 48 % | 16.3 | 19.2 | 0.43 |
| escape · normal | 90 | 100 % | 60 [50–70] | 36 | 4 | 18.9 | 44 % | 12.6 | 15.6 | 0.52 |
| mission · easy | 90 | 100 % | 69 [59–78] | 30 | 1 | 31.1 | 44 % | 5.7 | 7.8 | 0.60 |
| mission · hard | 90 | 100 % | 20 [13–29] | 77 | 3 | 32.4 | 53 % | 17.8 | 21.3 | 0.12 |
| mission · normal | 90 | 100 % | 47 [37–57] | 52 | 1 | 31.4 | 50 % | 11.9 | 15.1 | 0.54 |
| survival · easy | 90 | 100 % | 64 [54–74] | 20 | 16 | – | – | 0.8 | 1.1 | – |
| survival · hard | 90 | 100 % | 19 [12–28] | 73 | 8 | – | – | 0.8 | 0.8 | – |
| survival · normal | 90 | 100 % | 48 [38–58] | 48 | 4 | – | – | 0.7 | 0.8 | – |

## M1 – läge × activity (planerare)

| mode · activity | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |
|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|
| escape · mtb | 90 | 100 % | 49 [39–59] | 48 | 3 | 18.2 | 40 % | 10.7 | 14.4 | 0.91 |
| escape · run | 90 | 100 % | 62 [52–72] | 34 | 3 | 17.9 | 45 % | 13.5 | 15.5 | 1.02 |
| escape · walk | 90 | 100 % | 80 [71–87] | 14 | 6 | 19.0 | 47 % | 8.2 | 9.1 | 0.00 |
| mission · mtb | 90 | 100 % | 21 [14–31] | 77 | 2 | 32.2 | 47 % | 14.5 | 18.8 | 1.12 |
| mission · run | 90 | 100 % | 42 [33–53] | 58 | 0 | 30.7 | 48 % | 10.5 | 12.7 | 1.08 |
| mission · walk | 90 | 100 % | 72 [62–80] | 24 | 3 | 31.2 | 47 % | 7.3 | 8.1 | 0.00 |
| survival · mtb | 90 | 100 % | 21 [14–31] | 72 | 7 | – | – | 0.8 | 0.9 | – |
| survival · run | 90 | 100 % | 41 [32–51] | 56 | 3 | – | – | 0.9 | 1.1 | – |
| survival · walk | 90 | 100 % | 69 [59–78] | 13 | 18 | – | – | 0.5 | 0.4 | – |

## M1 – läge × area (planerare)

| mode · area | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |
|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|
| escape · i2-skogen | 90 | 100 % | 71 [61–79] | 24 | 4 | 18.9 | 44 % | 7.3 | 9.5 | 0.60 |
| escape · skutberget | 90 | 100 % | 56 [45–65] | 42 | 2 | 18.7 | 41 % | 16.8 | 18.8 | 0.51 |
| escape · sormon | 90 | 100 % | 64 [54–74] | 30 | 6 | 19.0 | 47 % | 11.3 | 14.7 | 0.58 |
| mission · i2-skogen | 90 | 100 % | 60 [50–70] | 39 | 1 | 31.2 | 46 % | 7.7 | 10.4 | 0.52 |
| mission · skutberget | 90 | 100 % | 31 [22–41] | 69 | 0 | 31.1 | 47 % | 17.4 | 19.9 | 0.41 |
| mission · sormon | 90 | 100 % | 44 [35–55] | 51 | 4 | 31.4 | 50 % | 11.7 | 15.3 | 0.57 |
| survival · i2-skogen | 90 | 100 % | 53 [43–63] | 41 | 6 | – | – | 0.2 | 0.3 | – |
| survival · skutberget | 90 | 100 % | 30 [22–40] | 61 | 9 | – | – | 1.0 | 1.0 | – |
| survival · sormon | 90 | 100 % | 48 [38–58] | 39 | 13 | – | – | 1.8 | 2.0 | – |

## M1 – läge × svårighet (ruttföljare)

| mode · difficulty | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |
|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|
| escape · easy | 90 | 100 % | 69 [59–78] | 31 | 0 | 18.7 | 40 % | – | – | 0.54 |
| escape · hard | 90 | 100 % | 30 [22–40] | 70 | 0 | 18.9 | 51 % | – | – | 0.45 |
| escape · normal | 90 | 100 % | 47 [37–57] | 53 | 0 | 18.8 | 45 % | – | – | 0.44 |
| mission · easy | 90 | 100 % | 53 [43–63] | 47 | 0 | 31.1 | 43 % | – | – | 0.46 |
| mission · hard | 90 | 100 % | 16 [9–24] | 84 | 0 | 30.2 | 52 % | – | – | 0.14 |
| mission · normal | 90 | 100 % | 26 [18–35] | 74 | 0 | 30.8 | 46 % | – | – | 0.27 |
| survival · easy | 90 | 100 % | 72 [62–80] | 20 | 8 | – | – | 0.0 | 0.0 | – |
| survival · hard | 90 | 100 % | 22 [15–32] | 73 | 4 | – | – | 0.0 | 0.0 | – |
| survival · normal | 90 | 100 % | 48 [38–58] | 49 | 3 | – | – | 0.0 | 0.0 | – |

## M2 – antal checkpoints (Mission, löpning, 5 km)

### planner

| cps | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |
|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | 135 | 100 % | 37 [29–45] | 61 | 2 | 31.1 | 49 % | 9.4 | 11.5 | 1.11 |
| 2 | 135 | 100 % | 36 [28–44] | 61 | 3 | 32.0 | 52 % | 10.5 | 13.2 | 1.18 |
| 3 | 135 | 100 % | 39 [31–48] | 60 | 1 | 31.3 | 50 % | 10.0 | 12.3 | 1.13 |

### follower

| cps | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |
|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | 135 | 100 % | 22 [16–30] | 78 | 0 | 29.5 | 44 % | – | – | 1.01 |
| 2 | 135 | 100 % | 19 [13–26] | 81 | 0 | 29.0 | 44 % | – | – | 1.01 |
| 3 | 135 | 100 % | 26 [19–34] | 74 | 0 | 30.8 | 44 % | – | – | 1.01 |

## M3 – återvändsgrenspolicy för checkpoints (Mission, löpning, 5 km)

### planner

| policy | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |
|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|
| allow | 180 | 100 % | 42 [35–50] | 55 | 3 | 30.1 | 49 % | 12.3 | 14.8 | 1.11 |
| avoid | 180 | 100 % | 43 [36–51] | 55 | 2 | 31.0 | 49 % | 11.8 | 13.9 | 1.11 |

### follower

| policy | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |
|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|
| allow | 180 | 100 % | 26 [20–33] | 74 | 0 | 28.6 | 43 % | – | – | 0.99 |
| avoid | 180 | 100 % | 28 [22–35] | 72 | 0 | 29.4 | 44 % | – | – | 1.01 |

