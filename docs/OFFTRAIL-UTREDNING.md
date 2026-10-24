# Off-trail play: investigation report

Request: the game must always be playable (Survival, Mission, A TO B), even where the map data has no usable trails. Zombies (and the player) should be able to move off the path network, with zombies at roughly 50 % of normal speed when they leave the paths.

Status: **investigation only. No code was changed.** Labels: **[fact]** read in code or data, **[sim]** simulation (bots, not people), **[assumption]**, **[phone]** untested on a real device.

## 1. What happened in the screenshot

The message comes from `src/play/prepare.ts:74–82`: `startSnapM === null`, i.e. **the walk graph built from the tiles is completely empty** within the data radius (Survival: at least 1.5 km on foot). Tile download errors give a different message, so this is "no eligible way within the radius" **[fact]**.

The basemap in the screenshot draws a road and a thin line next to the player, so the basemap knows more than the game's tile data does. The game only keeps `path, footway, track, cycleway, service, residential, living_street, unclassified, pedestrian, bridleway` (`decideWay`, `WALK_TYPES`), and drops major roads on purpose (they are hazards). I cannot tell from the screenshot which of these it was; with the coordinates I can check the tile **[open]**.

Four different gates can stop a match today **[fact]**:

| Gate | Where | Condition |
|---|---|---|
| `outside_region` | `store.covers` | start or B outside the Värmland bounding box (58.65–61.15 N, 11.6–14.6 E) |
| `off_network` | `prepare.ts:74` | no way within 150 m of start (or empty graph, as in the screenshot) |
| `sparse` | `prepare.ts:89` | Survival: connected network < 3 km |
| `no_route` | `generateCourse` / `generateAtoB` | no checkpoint course or no path A→B |

Off-trail movement removes the last three. The first one only goes away if the mode also works **without any tile data** (see option 1, "no-data mode").

## 2. How large is the problem

Tile coverage, Värmland (`manifest.json`) **[fact]**: 786 tile files for 1,500 grid cells (0.05° × 0.1°, about 5.5 × 5.7 km). So **48 % of the cells have no file at all** (lakes, border areas and genuinely empty land; I cannot split these without land-cover data). Of the 786 files: 3 % have one way or none, 21 % have ≤ 20 ways, 48 % have ≤ 50, the median is 53 and the maximum 4,175. A tile with 20 ways is rarely enough for 3 km of connected network, so the real "can't play here" share is higher than 48 % of the bounding box and certainly higher than the share of empty cells **[assumption: not measured as area]**.

## 3. Why the game can't just walk off the trails today

The whole engine is **graph-bound** **[fact]**. A zombie is `edgeId + distanceAlongEdgeM`; it can change edge only at shared nodes (`advanceZombie`, `movement.ts`). Everything else relies on the same model:

- AI planning: `planRoute` / A* on edges (`zombie-ai.ts`), interception, magnet pursuit.
- Player: `snapToGraph` (nearest edge, **linear scan over all edges**), sticky snapping, `makeObservation`.
- Infection: `infectionContactM` = network distance, not straight distance (the v2.2 barrier fix).
- Spawn, extraction, objectives, course generation, rendering of zombies from edge positions.

A player who is off the network is snapped to the nearest edge; the zombies wait at that point. That is today's de facto behaviour and it is also an exploit in covered areas (known risk 7.3 in the v2.2 report).

## 4. Options

### Option 1 (recommended): a synthetic off-trail lattice inside the existing graph model

Build an extra mesh of nodes (a regular lattice, 8-neighbour, say 40–50 m) over the play area and add it to the play graph as **edges flagged `offtrail` with `speedFactor` 0.5**. Real trail edges keep factor 1. Mesh nodes within a few metres of real nodes are connected to them. The engine stays graph-bound, so AI, infection, spawn and extraction keep working.

What has to change **[fact on the code, estimate on the effort]**:

| Area | Change | Size |
|---|---|---|
| Graph | `speedFactor`/`offtrail` on `RawEdge`, `SerializedGraph`, `buildGraph` (same plumbing as `grade`/`crossing`/`easy`) | small |
| Movement | `advanceZombie` spends its distance budget as `length / factor` per edge | small |
| Path costs | `planRoute`/A*: cost = `length / factor` (heuristic stays admissible for factor ≤ 1); `networkDistances` stays in metres for infection | small–medium |
| Snapping | **spatial index** for `snapToGraph*`. A mesh has 5–20 k edges; the current linear scan runs every second and per infection check | medium |
| Mesh builder | lattice over circle (Survival), capsule around A–B (A TO B), radius around start (Mission) | medium |
| Prepare | replace the four gates by "use the trail graph if it is good enough, else add the mesh" | small |
| Courses | checkpoints / extraction on the mesh (see section 6, safety) | medium |
| UI | "Open terrain" notice; no mesh drawn on the map | small |
| Rules | `RULES_VERSION` bump; saved matches from v2.2 stay on the old rules | small |
| Tests/sim | lattice bots, regression that trail-only matches are unchanged | medium |

Behaviour that falls out for free: with time-based A*, zombies **use trails when it is faster** and cut across country only when the shortcut beats the trail (a 2× longer trail route equals the 50 % off-trail speed). Mixed areas work without special cases, and the exploit "leave the trail and the zombies stop" disappears in covered areas too **[assumption: needs the mesh to be applied there as well, see phase 3]**.

Measured feasibility **[sim]**: the existing simulator on a synthetic lattice (22 × 22 and 50 × 50 and 100 × 100 nodes, 40 m spacing) costs **0.4 ms per 0.2 s step at 2,500 nodes and 1.1 ms at 10,000 nodes** on this development machine (planner bot, A* replans included). A phone is slower by some multiple I have not measured **[phone]**. 10,000 nodes at 40 m is 4 km², roughly a 1.1 km radius. Survival on foot needs radius ≥ 1.5 km, so use 50–60 m spacing or an adaptive lattice (fine near the player, coarse far away). A TO B up to 20 km straight needs a corridor, not a circle.

Weaknesses of option 1:
- **Zig-zag movement and snap error.** Zombies follow lattice edges, up to ~1.41× longer than straight (4-neighbour) or ~1.08× (8-neighbour); a player off the lattice snaps up to ~half a cell away. Both are within the 20 m infection radius's tolerance but visible as stepped movement. Path smoothing or a finer lattice near the player mitigates it.
- **Cost grows with area.** Hence the adaptive/corridor lattice.
- The lattice knows nothing about water, roads or buildings unless it is given a mask (section 6).

### Option 2: continuous-space pursuit for zombies that are off the network

Give zombies a lat/lon position and a straight-line pursuit mode when the player is off the network. Smoothest movement, no snap error, no mesh memory.
Against it: two movement models in one engine. `Zombie` is serialised and tested as "never leaves the graph", so the state type, save format, spawn, rendering, infection, simulator and many tests change, plus the transition between graph and free movement is a new bug surface. I rate it **higher risk than option 1 for the same visible result**.

### Option 3: widen the data instead of adding movement

Keep the graph model, but admit more ways (e.g. include minor `tertiary` roads and `steps`, drop the 150 m start limit, lower the 3 km minimum). Cheapest, and it would cure some "no trails" cases, but it does **not** meet the requirement ("always playable"): a start in a forest with no mapped way within kilometres stays impossible. It is also in conflict with the safety rule that the player never crosses a major road because the game suggests it. Useful only as a complement.

## 5. Balance: a flat 50 % is not enough on its own

Simulator, planner bot, 30 matches per row, lattice 40 m, no obstacles **[sim]**. "Survived" = the full 30 min. The player walks at 4.7 km/h unless stated.

| Zombies (flat speed everywhere) | Player | Survived 30 min | Alive after 10 min |
|---|---|---|---|
| Normal 7 km/h × 0.5 = 3.5 km/h | walker 4.7 km/h | 87 % (70–95) | 100 % (89–100) |
| same, large lattice (10 k nodes) | walker 4.7 km/h | 97 % (83–99) | 100 % (89–100) |
| same | slow walker 3.8 km/h | 90 % (74–97) | 100 % (89–100) |
| Hard 13 km/h × 0.5 = 6.5 km/h | walker 4.7 km/h | 0 % (0–11) | 13 % (5–30) |
| same | slow walker 3.8 km/h | 0 % (0–11) | 10 % (3–26) |
| Normal 3.5 km/h | runner 8 km/h | n/a here: 60 % at zombies 7 km/h (full speed) | 93 % |

Reading: because the outcome is driven by the speed **ratio** (the v2.2 finding), a flat 50 % puts Normal firmly on the player's side (open terrain is too easy) while Hard stays on the zombies' side (a walker is still slower than 6.5 km/h). One factor will not serve all three difficulties; the off-trail factor must be a per-difficulty parameter, and it should be tuned with the same method as v2.2 (a bot sweep before changing anything). Open terrain also gives the player something trails don't: the zombies can be outwalked in any direction, whereas on trails they come head-on along the only way. That is likely why the walker wins so often, and an obstacle mask would lower it **[assumption, untested]**.

Counterpoint to my own recommendation of 50 %: the user's number is plausible for forest and fields (people walk 30–60 % of path speed off-trail), but on open ground such as a football field or frozen lake the real ratio is closer to 1.0. Without land-cover data the game cannot tell them apart.

## 6. Safety, rules and data (the real constraint)

1. **Safety messaging.** The game currently says "Never cross a road or railway just because the game suggests it". Off-trail play puts the player where there is no marked path at all: roads, rails, lakes, private gardens and fences are not in the tile data **[fact]**. Zombies would walk through lakes (visible) and, worse, checkpoints or extraction points could land in water or on a road.
2. Mitigations, from cheapest to most work:
   - Place checkpoints and extraction on real ways whenever any exist within the area, and off-trail only when nothing else is available; show the proposal on the map (NEW COURSE already exists) with a warning that the player must judge the terrain.
   - A **terrain mask** from the pipeline: `build_tiles.py` could write a coarse blocked/free bitmap per tile (water, major roads, railways, buildings) from the same PBF. At 25 m cells a 5.5 × 5.7 km tile is about 50 k bits, about 6 kB before gzip, compared with 31 MB for the existing tiles **[estimate]**. This also lets the lattice avoid blocked cells.
   - Read the mask at run time from the basemap vector tiles that MapLibre already loads (OpenFreeMap). This avoids new data but depends on being online and on a vector-tile parser; I have not tried it **[open]**.
3. **Legal/ethical**: encouraging people into forest or onto private land at night is a product decision. The mode should be explicit ("Open terrain") rather than silent.

## 7. Suggested plan (for discussion)

| Phase | Content | Result |
|---|---|---|
| 0 | Spike on a branch: lattice builder + `speedFactor` + spatial snap index; measure build time, memory and frame cost on a real phone | go/no-go on option 1 |
| 1 | Open-terrain mode only where the trail data fails (the four gates); per-difficulty off-trail factor via a bot sweep; checkpoint/extraction rules and warnings | "always playable" |
| 2 | Terrain mask in the tile pipeline (water, major roads, rail, buildings) | no lake swimming, no checkpoints in water |
| 3 | Apply the lattice also in partially covered areas, so leaving the trails is never a safe haven | consistent rules everywhere |

Phases 0–1 reuse the existing engine, and trail-only matches must stay **bit-identical** (as in the v2.2 regression, 180 matches on master vs. branch); that is the main regression test.

## 8. Open questions for you

1. Is the player also slower off-trail (the mesh only matters for the zombies, the real player moves as they like)? Your message says the zombie factor is the lever; I assumed the player is unrestricted.
2. Is 50 % meant for all difficulties? (Section 5 says no for Hard.)
3. Is open-terrain play acceptable from a safety/legal view, with the warnings above, or should it be limited to areas the terrain mask says are free?
4. Should the mode work **outside Värmland** (no tiles at all)? Technically cheap with option 1; it widens the safety question.
5. The coordinates of the screenshot, so I can see which of the gates failed and whether the basemap road was in the data.

## 9. What I did not verify

- No mesh was built on real map data; the numbers in section 5 are from a synthetic lattice with no obstacles and one bot type.
- Phone performance of a 5–10 k-node graph and of A* replans **[phone]**.
- The effort in section 4 is an estimate from reading the code, not a measured plan.
- Whether the mask-from-basemap idea (section 6) works at all.
