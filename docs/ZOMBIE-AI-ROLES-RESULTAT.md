# Zombie-AI med roller: jämförelse gammal/ny AI (rådata)

Kör: `npx tsx scripts/ai-compare.ts <matcher> <nät> <aktiviteter> <spelare> <svårighet> <tempo>`. Förklaring av kolumnerna: [ZOMBIE-AI-ROLES.md](ZOMBIE-AI-ROLES.md), avsnitt 6.

## Zombie AI: old against roles (normal, Survival, 16 matches per cell, seeds 100…115, player pace {"walk":1.5,"mtb":1})

| network | activity | player | AI | caught (95 %) | median min to capture | plans/match | met / contact / passed / missed | behind | spread | caught off trail | caught by interceptor | searches/min | nodes/min | ms/step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| grid | walk | risk | old | 100% (81%–100%) | 4.5 | 0.3 | 0% / 0% / 0% / 100% | 27% | 0.18 | 0% | 31% | 262.5 | 4160 | 0.082 |
| grid | walk | risk | roles | 100% (81%–100%) | 4.6 | 2.9 | 0% / 6% / 0% / 94% | 33% | 0.16 | 0% | 13% | 259.3 | 4136 | 0.064 |
| grid | walk | random | old | 100% (81%–100%) | 3.9 | 0.1 | 0% / 0% / 0% / 100% | 18% | 0.20 | 0% | 19% | 266.1 | 3943 | 0.057 |
| grid | walk | random | roles | 100% (81%–100%) | 4.2 | 2.4 | 3% / 5% / 0% / 92% | 20% | 0.21 | 0% | 25% | 255.1 | 3807 | 0.047 |
| grid | walk | straight | old | 100% (81%–100%) | 3.6 | 0.1 | 0% / 0% / 0% / 100% | 28% | 0.15 | 0% | 31% | 308.2 | 5314 | 0.051 |
| grid | walk | straight | roles | 100% (81%–100%) | 3.6 | 1.2 | 0% / 26% / 0% / 74% | 22% | 0.16 | 0% | 31% | 273.1 | 5047 | 0.056 |
| grid | mtb | risk | old | 100% (81%–100%) | 8.5 | 0.8 | 0% / 0% / 0% / 100% | 54% | 0.14 | 0% | 25% | 401.0 | 21212 | 0.187 |
| grid | mtb | risk | roles | 100% (81%–100%) | 10.2 | 4.6 | 0% / 0% / 0% / 100% | 52% | 0.14 | 0% | 31% | 386.5 | 21412 | 0.179 |
| grid | mtb | random | old | 100% (81%–100%) | 7.7 | 0.2 | 0% / 0% / 0% / 100% | 32% | 0.16 | 0% | 38% | 372.2 | 25913 | 0.150 |
| grid | mtb | random | roles | 100% (81%–100%) | 8.2 | 2.4 | 0% / 10% / 0% / 90% | 34% | 0.15 | 0% | 25% | 367.1 | 24591 | 0.150 |
| grid | mtb | straight | old | 100% (81%–100%) | 3.9 | 0.2 | 0% / 0% / 0% / 100% | 24% | 0.17 | 0% | 44% | 377.3 | 31271 | 0.185 |
| grid | mtb | straight | roles | 100% (81%–100%) | 3.9 | 0.9 | 0% / 50% / 0% / 50% | 3% | 0.11 | 0% | 38% | 355.5 | 33630 | 0.191 |
| karlstad | walk | risk | old | 100% (81%–100%) | 9.7 | 0.4 | 0% / 0% / 0% / 100% | 52% | 0.41 | 0% | 38% | 351.1 | 36361 | 0.606 |
| karlstad | walk | risk | roles | 100% (81%–100%) | 8.3 | 0.8 | 8% / 17% / 0% / 75% | 51% | 0.42 | 0% | 25% | 293.6 | 27295 | 0.600 |
| karlstad | walk | random | old | 100% (81%–100%) | 4.8 | 0.3 | 0% / 0% / 0% / 100% | 34% | 0.53 | 0% | 38% | 367.3 | 57023 | 0.449 |
| karlstad | walk | random | roles | 100% (81%–100%) | 4.8 | 0.5 | 25% / 38% / 0% / 38% | 35% | 0.52 | 0% | 31% | 274.0 | 32602 | 0.388 |
| karlstad | walk | straight | old | 100% (81%–100%) | 5.3 | 0.3 | 0% / 0% / 0% / 100% | 45% | 0.43 | 0% | 38% | 356.7 | 44671 | 0.446 |
| karlstad | walk | straight | roles | 100% (81%–100%) | 4.9 | 0.4 | 0% / 50% / 0% / 50% | 46% | 0.43 | 0% | 19% | 274.2 | 25846 | 0.382 |
| karlstad | mtb | risk | old | 100% (81%–100%) | 27.2 | 1.0 | 6% / 0% / 0% / 94% | 68% | 0.17 | 0% | 38% | 177.9 | 20651 | 1.467 |
| karlstad | mtb | risk | roles | 100% (81%–100%) | 27.5 | 1.8 | 0% / 0% / 0% / 100% | 69% | 0.16 | 0% | 6% | 168.2 | 16387 | 1.355 |
| karlstad | mtb | random | old | 100% (81%–100%) | 12.0 | 0.1 | 0% / 0% / 0% / 100% | 36% | 0.45 | 0% | 19% | 94.6 | 19487 | 1.129 |
| karlstad | mtb | random | roles | 100% (81%–100%) | 12.0 | 0.1 | 0% / 0% / 0% / 100% | 34% | 0.45 | 0% | 13% | 90.7 | 17730 | 1.152 |
| karlstad | mtb | straight | old | 100% (81%–100%) | 12.9 | 0.2 | 0% / 0% / 0% / 100% | 47% | 0.19 | 0% | 13% | 118.9 | 22368 | 1.233 |
| karlstad | mtb | straight | roles | 100% (81%–100%) | 12.7 | 0.2 | 0% / 100% / 0% / 0% | 48% | 0.30 | 0% | 19% | 95.4 | 16955 | 1.157 |
| skog | walk | risk | old | 100% (81%–100%) | 7.7 | 0.1 | 0% / 0% / 0% / 100% | 53% | 0.31 | 0% | 50% | 294.5 | 3831 | 0.109 |
| skog | walk | risk | roles | 100% (81%–100%) | 9.3 | 2.1 | 0% / 12% / 0% / 88% | 54% | 0.28 | 0% | 19% | 312.2 | 3642 | 0.116 |
| skog | walk | random | old | 100% (81%–100%) | 3.7 | 0.0 | – | 40% | 0.36 | 0% | 44% | 259.2 | 4151 | 0.094 |
| skog | walk | random | roles | 100% (81%–100%) | 4.2 | 1.2 | 0% / 42% / 0% / 58% | 41% | 0.33 | 0% | 44% | 269.7 | 4044 | 0.104 |
| skog | walk | straight | old | 100% (81%–100%) | 4.0 | 0.0 | – | 55% | 0.27 | 0% | 44% | 268.4 | 3665 | 0.099 |
| skog | walk | straight | roles | 100% (81%–100%) | 4.0 | 0.9 | 7% / 27% / 0% / 67% | 52% | 0.30 | 0% | 31% | 273.4 | 3838 | 0.103 |
| skog | mtb | risk | old | 100% (81%–100%) | 27.2 | 0.5 | 0% / 0% / 0% / 100% | 63% | 0.24 | 0% | 38% | 194.9 | 13115 | 1.083 |
| skog | mtb | risk | roles | 100% (81%–100%) | 21.7 | 3.6 | 0% / 0% / 0% / 100% | 58% | 0.26 | 0% | 6% | 191.3 | 14424 | 1.086 |
| skog | mtb | random | old | 100% (81%–100%) | 12.2 | 0.1 | 0% / 0% / 0% / 100% | 52% | 0.33 | 0% | 6% | 139.2 | 15391 | 1.037 |
| skog | mtb | random | roles | 100% (81%–100%) | 12.2 | 1.6 | 0% / 19% / 0% / 81% | 49% | 0.26 | 0% | 31% | 163.7 | 14555 | 1.030 |
| skog | mtb | straight | old | 100% (81%–100%) | 19.2 | 0.1 | 0% / 0% / 0% / 100% | 61% | 0.31 | 0% | 44% | 157.9 | 9982 | 0.985 |
| skog | mtb | straight | roles | 100% (81%–100%) | 17.9 | 0.7 | 0% / 45% / 0% / 55% | 68% | 0.23 | 0% | 31% | 180.0 | 11586 | 1.022 |

## Zombie AI: old against roles (normal, Survival, 12 matches per cell, seeds 100…111, player pace {"walk":1.5,"mtb":1})

| network | activity | player | AI | caught (95 %) | median min to capture | plans/match | met / contact / passed / missed | behind | spread | caught off trail | caught by interceptor | searches/min | nodes/min | ms/step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| skog+terrain | walk | risk | old | 100% (76%–100%) | 8.7 | 0.0 | – | 46% | 0.40 | 8% | 0% | 7.3 | 38714 | 0.687 |
| skog+terrain | walk | risk | roles | 100% (76%–100%) | 8.6 | 1.6 | 5% / 5% / 0% / 89% | 50% | 0.32 | 0% | 25% | 14.7 | 40985 | 0.689 |
| skog+terrain | walk | random | old | 100% (76%–100%) | 6.2 | 0.0 | – | 37% | 0.38 | 42% | 0% | 9.2 | 48639 | 0.407 |
| skog+terrain | walk | random | roles | 100% (76%–100%) | 6.2 | 1.0 | 8% / 25% / 0% / 67% | 36% | 0.41 | 25% | 50% | 16.9 | 48779 | 0.406 |
| skog+terrain | walk | straight | old | 100% (76%–100%) | 4.9 | 0.0 | – | 47% | 0.37 | 42% | 0% | 9.1 | 48504 | 0.391 |
| skog+terrain | walk | straight | roles | 100% (76%–100%) | 4.9 | 0.3 | 0% / 100% / 0% / 0% | 51% | 0.32 | 50% | 8% | 16.9 | 49536 | 0.410 |
| skog+terrain | mtb | risk | old | 92% (65%–99%) | 18.1 | 0.0 | – | 61% | 0.25 | 36% | 0% | 250.1 | 79318 | 1.232 |
| skog+terrain | mtb | risk | roles | 100% (76%–100%) | 13.4 | 1.5 | 0% / 0% / 0% / 100% | 60% | 0.29 | 8% | 0% | 229.2 | 65754 | 1.148 |
| skog+terrain | mtb | random | old | 100% (76%–100%) | 12.3 | 0.0 | – | 44% | 0.33 | 25% | 0% | 162.9 | 44423 | 0.437 |
| skog+terrain | mtb | random | roles | 100% (76%–100%) | 13.6 | 1.3 | 0% / 31% / 0% / 69% | 45% | 0.37 | 33% | 25% | 163.0 | 41086 | 0.425 |
| skog+terrain | mtb | straight | old | 58% (32%–81%) | 18.2 | 0.0 | – | 68% | 0.21 | 86% | 0% | 243.2 | 111965 | 0.853 |
| skog+terrain | mtb | straight | roles | 67% (39%–86%) | 20.1 | 1.2 | 0% / 21% / 0% / 79% | 67% | 0.28 | 75% | 50% | 242.0 | 114823 | 0.844 |

## Zombie AI: old against roles (normal, Survival, 12 matches per cell, seeds 100…111, player pace {"walk":1.5,"mtb":1})

| network | activity | player | AI | caught (95 %) | median min to capture | plans/match | met / contact / passed / missed | behind | spread | caught off trail | caught by interceptor | searches/min | nodes/min | ms/step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| karlstad+terrain | walk | risk | old | 100% (76%–100%) | 12.5 | 0.0 | – | 53% | 0.33 | 58% | 0% | 9.1 | 76054 | 1.569 |
| karlstad+terrain | walk | risk | roles | 92% (65%–99%) | 23.1 | 1.8 | 0% / 5% / 5% / 91% | 61% | 0.28 | 73% | 36% | 14.9 | 75250 | 1.518 |
| karlstad+terrain | walk | random | old | 100% (76%–100%) | 6.0 | 0.0 | – | 33% | 0.54 | 42% | 0% | 10.7 | 89039 | 0.903 |
| karlstad+terrain | walk | random | roles | 100% (76%–100%) | 6.9 | 1.8 | 0% / 24% / 0% / 76% | 34% | 0.54 | 42% | 25% | 17.5 | 89981 | 0.974 |
| karlstad+terrain | walk | straight | old | 42% (19%–68%) | 3.5 | 0.0 | – | 67% | 0.17 | 60% | 0% | 10.4 | 87086 | 0.878 |
| karlstad+terrain | walk | straight | roles | 75% (47%–91%) | 4.8 | 0.5 | 0% / 50% / 0% / 50% | 65% | 0.22 | 56% | 44% | 15.6 | 87599 | 0.919 |
| karlstad+terrain | mtb | risk | old | 92% (65%–99%) | 31.4 | 0.0 | – | 58% | 0.17 | 82% | 0% | 255.7 | 89412 | 1.414 |
| karlstad+terrain | mtb | risk | roles | 75% (47%–91%) | 35.7 | 2.9 | 0% / 0% / 0% / 100% | 59% | 0.18 | 100% | 33% | 256.4 | 84424 | 1.338 |
| karlstad+terrain | mtb | random | old | 100% (76%–100%) | 11.1 | 0.0 | – | 42% | 0.34 | 42% | 0% | 146.0 | 62354 | 0.605 |
| karlstad+terrain | mtb | random | roles | 100% (76%–100%) | 10.1 | 0.5 | 17% / 33% / 0% / 50% | 36% | 0.31 | 33% | 33% | 147.4 | 63802 | 0.631 |
| karlstad+terrain | mtb | straight | old | 42% (19%–68%) | 14.7 | 0.0 | – | 58% | 0.25 | 100% | 0% | 244.7 | 144658 | 1.000 |
| karlstad+terrain | mtb | straight | roles | 33% (14%–61%) | 17.7 | 0.8 | 0% / 10% / 0% / 90% | 64% | 0.17 | 100% | 50% | 238.4 | 136591 | 0.975 |

## Zombie AI: old against roles (easy, Survival, 16 matches per cell, seeds 100…115, player pace {"walk":1})

| network | activity | player | AI | caught (95 %) | median min to capture | plans/match | met / contact / passed / missed | behind | spread | caught off trail | caught by interceptor | searches/min | nodes/min | ms/step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| grid | walk | risk | old | 100% (81%–100%) | 9.3 | 0.0 | – | 36% | 0.13 | 0% | 0% | 213.6 | 3411 | 0.055 |
| grid | walk | risk | roles | 100% (81%–100%) | 9.1 | 1.3 | 0% / 10% / 0% / 90% | 27% | 0.15 | 0% | 19% | 204.5 | 3208 | 0.053 |
| grid | walk | random | old | 100% (81%–100%) | 8.3 | 0.0 | – | 22% | 0.16 | 0% | 0% | 204.1 | 2868 | 0.042 |
| grid | walk | random | roles | 100% (81%–100%) | 7.6 | 0.9 | 0% / 27% / 0% / 73% | 17% | 0.19 | 0% | 19% | 193.3 | 2733 | 0.042 |
| grid | walk | straight | old | 81% (57%–93%) | 5.2 | 0.0 | – | 29% | 0.12 | 0% | 0% | 216.3 | 4061 | 0.047 |
| grid | walk | straight | roles | 94% (72%–99%) | 5.3 | 0.5 | 0% / 75% / 0% / 25% | 19% | 0.15 | 0% | 40% | 201.0 | 3380 | 0.046 |
| skog | walk | risk | old | 94% (72%–99%) | 21.1 | 0.0 | – | 55% | 0.31 | 0% | 0% | 245.2 | 2857 | 0.102 |
| skog | walk | risk | roles | 94% (72%–99%) | 20.0 | 1.4 | 4% / 22% / 0% / 74% | 56% | 0.30 | 0% | 13% | 236.6 | 2691 | 0.099 |
| skog | walk | random | old | 88% (64%–97%) | 6.4 | 0.0 | – | 44% | 0.35 | 0% | 0% | 217.2 | 3119 | 0.079 |
| skog | walk | random | roles | 100% (81%–100%) | 6.9 | 0.8 | 0% / 62% / 0% / 38% | 43% | 0.35 | 0% | 38% | 209.4 | 2853 | 0.083 |
| skog | walk | straight | old | 100% (81%–100%) | 6.4 | 0.0 | – | 52% | 0.25 | 0% | 0% | 213.4 | 2747 | 0.086 |
| skog | walk | straight | roles | 100% (81%–100%) | 6.4 | 0.4 | 0% / 67% / 0% / 33% | 56% | 0.24 | 0% | 25% | 220.6 | 2644 | 0.084 |
| skog+terrain | walk | risk | old | 81% (57%–93%) | 18.0 | 0.0 | – | 48% | 0.39 | 0% | 0% | 5.7 | 30551 | 0.578 |
| skog+terrain | walk | risk | roles | 100% (81%–100%) | 20.3 | 1.1 | 0% / 22% / 6% / 72% | 47% | 0.36 | 0% | 19% | 11.0 | 30808 | 0.556 |
| skog+terrain | walk | random | old | 100% (81%–100%) | 12.4 | 0.0 | – | 39% | 0.41 | 31% | 0% | 6.2 | 32742 | 0.279 |
| skog+terrain | walk | random | roles | 100% (81%–100%) | 11.7 | 0.3 | 25% / 50% / 0% / 25% | 36% | 0.39 | 25% | 19% | 11.0 | 32788 | 0.281 |
| skog+terrain | walk | straight | old | 75% (51%–90%) | 10.0 | 0.0 | – | 54% | 0.29 | 42% | 0% | 6.4 | 34086 | 0.291 |
| skog+terrain | walk | straight | roles | 50% (28%–72%) | 7.4 | 0.2 | 0% / 33% / 0% / 67% | 57% | 0.25 | 25% | 13% | 12.0 | 34282 | 0.280 |
