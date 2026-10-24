# Off-trail play, addendum: bike mode and data coverage

Addendum to `docs/OFFTRAIL-UTREDNING.md` (on branch `docs/offtrail-investigation`). Request: on foot, zombies may leave the paths at roughly 30–50 % of normal speed; on a bike the player cannot leave the roads, so the bike rules must differ, bike mode must still be playable in every map situation, and I should look for smart ideas. **Investigation only. No game code was changed.**

Labels: **[fact]** read in code/data, **[measured]** run on the real Värmland tiles, **[sim]** bot simulation on a synthetic lattice, **[assumption]**, **[phone]** untested on a device.

## 1. Short answer

1. The two modes really need different rules. On foot the *player* leaves the paths, so the zombies must be able to follow. On a bike only the *zombies* would ever be off the roads, and a slow zombie off-road is almost never useful to them (section 4). Bike mode does not need an open-terrain mesh.
2. For bike, "playable everywhere" is mostly a **data-connectivity problem**, not a movement problem. The measurements show that most failures come from the network being split into pieces and from the game picking the nearest small piece (section 3). Cheap fixes exist: **slow gap-bridging links** between pieces and a **better choice of network piece**.
3. Where there is truly no bikeable road, a bike match on an open lattice is degenerate in simulation: either the zombies are fast and nobody survives, or they are slow and nobody is caught (section 4). The honest options there are a "walk it" fallback or an explicit open-terrain bike mode with a different goal. This needs a product decision.
4. A neat way to avoid two sets of percentages: define the off-trail zombie speed as an **absolute walking speed per difficulty** (about 2.5 / 3.5 / 4.5 km/h), the same for foot and bike, instead of a percentage of the on-trail speed (section 5).

## 2. What bike mode looks like today [fact]

| Item | Foot (`walk`) | Bike (`mtb`) |
|---|---|---|
| Zombie speed on paths, Easy / Normal / Hard | 4.5 / 7 / 13 km/h | 14 / 17 / 24 km/h |
| Player pace | 1.3 m/s (4.7 km/h) | 4.5 m/s (16 km/h) |
| Survival data radius | 1.5 km (max with 0.5 × pace × duration) | 5–6 km |
| Zombie magnet range | unlimited | 2,000 m |
| Network filter (`decideWay`) | foot-eligible ways | bike-eligible ways: foot-only paths and footways (without `bicycle=yes`), `mtb:scale` ≥ 3 and `bicycle=no` are excluded |
| Who uses which ways | everyone | **zombies only use bike-eligible ways too** (the comment in `prepare.ts` says "every way", meaning every rideable way) |
| Mission checkpoints | any way | the *easy* subset (paved, gravel, good tracks) when it can make a course |

The gates that block a match (start > 150 m from a way, Survival < 3 km connected, no course, outside the Värmland box) apply to bike as well. In bike mode the start-component choice also feeds the extra "easy network" check for Mission.

## 3. Measured on the real tiles [measured]

Method: random start points on the real Värmland tiles, graph built with the production code (`buildRegionGraph`, play network), same 3 km connected-network gate as `prepare.ts`. Starts were chosen on a random eligible way inside a random tile file (so tile-weighted, not population-weighted; lakes, forests and borders are not separated out). Sample sizes are 60–100 per row; read differences of less than about ±10 percentage points as noise.

**a. Where people stand matters.** Uniformly random points in the bounding box (n = 160): only **13 % pass the walking gate** and 16 % the bike gate; inside tile files 23 % / 27 %. Most failures there are the 150 m start-distance gate (the box includes lakes, forest and Norway), so this number overstates the problem for people who stand on or near a path, and understates it for someone starting in a garden or a forest. It is the case the screenshot shows.

**b. Starting on a way (the realistic case).** (n = 100 each.) Start on a walkable way: **83 % pass walk Survival**, 90 % pass bike Survival. Start on a bikeable way: 82 % walk, 89 % bike. So roughly **one start in six fails on foot and one in ten fails on a bike even when standing on a mapped way**.

**c. Letting zombies use foot-only ways does not rescue bike.** At 6 km radius around bike starts (n = 80), the median connected network is 42.5 km for bike ways vs 46.3 km if foot-only ways were added; total mapped length is 139.8 vs 140.4 km. Of the 7 bike failures, **0** would pass with foot ways added. The foot-only-ways idea is not worth its complexity.

**d. The network is fragmented, and the game picks the nearest piece.**
- Within 6 km of a bike start the median total network is about 140 km but the chosen connected piece holds about 42 km (roughly a third).
- `assemble()` in `region-graph.ts` takes the **nearest** component of at least 1.5 km, not the largest. The nearest piece was smaller than 90 % of the largest in 27 of 60 bike starts and 7 of 60 foot starts.

**e. Gap-bridging links help a lot, cheaply.** I joined any two network pieces whose nearest nodes are within a gap G (all pieces inside the radius, offline analysis; n = 60 starts each):

| Bridge gaps up to | Bike (r = 6 km): median connected km | Bike: starts with < 3 km | Bike: < 10 km | Foot (r = 1.5 km): starts with < 3 km |
|---|---|---|---|---|
| none | 24.7 | 15 / 60 | 25 / 60 | 14 / 60 |
| 100 m | 49.7 | 9 / 60 | 17 / 60 | 10 / 60 |
| 250 m | 72.7 | 5 / 60 | 11 / 60 | 6 / 60 |
| 500 m | 116.8 | 1 / 60 | 3 / 60 | 2 / 60 |
| 1,000 m | 139.5 | 0 / 60 | 0 / 60 | 1 / 60 |

Caveat: in this probe the start piece is the one holding the nearest node, which is more pessimistic than the production rule (nearest piece of at least 1.5 km). Read the trend, not the "none" row. The links need a safety rule (section 6), because a 250–500 m gap link can run across a major road or a lake.

## 4. Why off-road bike zombies matter little [sim]

Simulator, planner bot, synthetic 60 × 60 lattice with 60 m spacing (3.6 km square, no obstacles), bike activity, 24 matches per row. "Survived" = full 45 min.

| Zombies | Cyclist | Survived 45 min | Alive after 10 min | Median time to infection |
|---|---|---|---|---|
| Normal, 17 km/h (full road speed) | 16 km/h | 0 % (0–14) | 96 % (80–99) | 8.8 min |
| Normal, 17 km/h | 10 km/h (slow cyclist) | 0 % (0–14) | 71 % (51–85) | 8.7 min |
| Normal, 6 km/h | 10 km/h | 96 % (80–99) | 100 % (86–100) | n/a |
| Normal, 4 km/h | 10 km/h | 92 % (74–98) | 100 % (86–100) | n/a |
| Normal, 4 km/h | 5 km/h (cyclist pushing the bike) | 50 % (31–69) | 100 % (86–100) | n/a |
| Hard, 24 km/h | 16 km/h | 0 % (0–14) | 0 % (0–14) | 6.5 min |
| Hard, 6 km/h | 10 km/h | 88 % (69–96) | 100 % (86–100) | n/a |

Reading:
- A zombie off-trail at walking speed (4–6 km/h) cannot catch a moving cyclist (88–96 % survive) except by ambushing from ahead. In a **mixed** network a zombie only leaves the road when the shortcut is more than about 17/4 ≈ 4× shorter than the road route (time-based A* with factor 0.24); real road networks rarely have that, so off-road shortcuts will seldom change the outcome in covered areas. [assumption: not simulated on a real mixed graph]
- A **fully open** bike match has no good middle: at full road speed nobody survives, at walking speed nobody is caught. The difficulty on a bike lives on the roads, as it does today.
- The bike simulation uses the same lattice bot as the foot study; it says nothing about how tense it feels.

## 5. Ideas, with trade-offs

**Idea A: absolute off-trail zombie speed (recommended).** Define "off-trail speed" per difficulty in km/h, independent of activity, for example Easy 2.5, Normal 3.5, Hard 4.5. On foot this equals 55 %, 50 % and 35 % of the path speed (4.5 / 7 / 13), inside the 30–50 % you suggested; on a bike it equals 18 %, 21 % and 19 % of path speed. Reason: a zombie walking through a forest moves at human forest speed, not at a share of a cyclist's speed. One table, two modes. Counter-argument: Hard becomes much gentler off-trail (4.5 km/h is about equal to a walker) than on paths. That is intended (paths are where the danger is), but it changes the Hard feel and should be tuned with the same bot sweep as v2.2 before anything is fixed.

**Idea B: bridge gaps between network pieces, bike first.** At match preparation, join pieces whose nearest nodes are within 250–500 m with a link edge at the absolute off-trail speed above (a zombie must walk the gap). Measured gain in section 3e. Cost: small (a node-pair search and link edges), and it reuses the per-edge speed factor that the foot mesh would need anyway. Risks: links must not be drawn or suggested to the player; links over large lakes need the terrain mask; for Mission/A TO B they must stay out of the strict (course) graph, exactly like the play/strict split in v2.2.

**Idea C: choose the network piece better.** Instead of the nearest piece of at least 1.5 km, pick the piece with the best score of size and distance (for example the largest piece within 300 m of the start, else the nearest). Free (no new data, no new rules), and 27 of 60 bike starts had a bigger piece available. Counter-argument: the start piece also defines where zombies may spawn; a piece 250 m away may be across a road, so the player may not be on it. With idea B the issue is smaller, because the pieces get joined.

**Idea D: a dismount rule for the bike player.** If a cyclist's GPS leaves the bikeable network by more than about 40 m for more than about 10 s (pushing the bike on a footpath, carrying it over a field), the rules treat the player as on foot for that stretch, so zombies follow at the off-trail speed. That removes today's "leave the roads and the zombies stop" exploit for bike too. It needs the same lattice/off-trail edges as the foot mode, but only locally around the player. Counter-argument: false positives from GPS noise or from a bikeable way missing in the data would turn the zombies slow for a rider who is simply on an unmapped road; the threshold and a hysteresis are needed.

**Idea E: when there is truly no bikeable road, say so and fall back.** The honest minimum for "playable everywhere": below, say, 3 km of bikeable network after ideas B and C, offer "By foot" (with the foot rules) instead of an error, or run bike with an explicit open-terrain mode whose goal is different (e.g. a zombie-free zone with fewer zombies, since section 4 shows the two extremes). Counter-argument: you asked for bike to work in all map scenarios; this is a degraded experience and I would not call it the same mode.

**Rejected:** a mesh for bike (section 4: degenerate and costly), foot-only ways for bike zombies (section 3c: no gain), and any rule that makes zombies run at bike speed off-road (unrealistic, and it would make open ground lethal).

## 6. Safety and rules [assumption + fact]

- The game's rule "never cross a road or railway because the game suggests it" is about the **player's route**, which the game lays out on the strict network. Zombie-only links (idea B) are not suggestions to the player, but the player may still choose to follow a zombie-free gap. The linking logic should stay out of anything the UI draws or the course generator uses.
- Major roads are excluded from the bike network on purpose. Zombies on major roads would not need the player on them. I have not measured how much coverage this would add; I would not include it before the safety discussion.
- Bridging across water (idea B at 500 m or more) is invisible in the tile data, as in the foot report. The terrain mask proposed there also solves this for bike.
- `RULES_VERSION` bump is needed for any of this; trail-only matches must stay identical to today (the v2.2 regression of 180 matches on master vs branch is the model).

## 7. Suggested order

| Step | Content | Why first |
|---|---|---|
| 1 | Idea C (better piece choice) with a measurement on the real tiles | no rules change; measurable on the same 80–100 starts |
| 2 | Idea B for bike with the absolute off-trail speed table (idea A), plus the per-edge speed factor | same machinery as the foot mesh; large gain per the table |
| 3 | Foot mesh (main report) | builds on step 2's speed factor and time-cost A* |
| 4 | Idea D (dismount) and idea E (fallback) | depends on the first steps and on a product decision |
| 5 | Terrain mask in the tile pipeline | safety for links and mesh |

## 8. Questions for you

1. Is an absolute off-trail speed table (idea A) acceptable, or do you want percentages per mode?
2. For a bike match with no bikeable road at all: fall back to foot rules (idea E), or play with an open-terrain bike mode anyway, accepting that it can be pointless?
3. Is a 250–500 m zombie-only gap link acceptable where the gap may contain a road or water until the terrain mask exists?
4. Should the dismount rule (idea D) be part of the first version?

## 9. What I did not verify

- All coverage numbers use random starts on real tiles but are tile-weighted, not population-weighted, and the samples are 60–100; they show size and direction only.
- The gap-bridging table uses a pessimistic start-piece rule and ignores hazards and water.
- The bike simulation runs on an obstacle-free lattice with one bot type and a lattice for the zombies; I did not simulate a mixed road-plus-gap graph (the engine cannot yet do per-edge speeds).
- Nothing was tested on a phone **[phone]**, including battery and frame cost of larger graphs.
