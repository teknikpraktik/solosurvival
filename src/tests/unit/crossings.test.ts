import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RULES_VERSION, STEP_S, resolveRules } from "@/config/game-rules";
import { buildRegionGraph } from "@/data/region-graph";
import type { TileWay } from "@/data/tile-format";
import { createGame, stepGame } from "@/engine/core/engine";
import type { Zombie } from "@/engine/core/types";
import { zombieLatLon } from "@/engine/core/movement";
import { chooseExtraction } from "@/engine/extraction/extraction";
import { infectionContactM } from "@/engine/infection/contact";
import { fromLocal, haversineM } from "@/geo/geometry";
import { indexGraph, snapToGraph, snapToGraphNear } from "@/geo/graph/graph";
import { TileStore, type Fetcher } from "@/data/store";
import { defaultParams, withActivity } from "@/play/config";
import { prepareMatch } from "@/play/prepare";
import { SimSession } from "@/sim/runner";
import { ORIGIN } from "@/sim/test-graphs";

/**
 * Syntetisk gata i Karlstad-stil: en större väg (ingår inte i nätet) längs y-axeln, trottoarer på var sida (x = ∓8 m) och
 * en gångpassage vid y = 0. Vägen ligger i datat bara som "hazard"-index (stigar som delar nod med den).
 */
type P = [number, number];
const ll = ([x, y]: P) => fromLocal(ORIGIN, { x, y });
function way(id: string, highway: string, pts: [string, P][], extra: Partial<TileWay> & { tags?: Record<string, string> } = {}): TileWay {
  const { tags, hazard, ...rest } = extra;
  return { id, tags: { highway, ...tags }, nodes: pts.map(([nid, p]) => ({ id: nid, ...ll(p) })), hazard: hazard ?? [], ...rest };
}

const sidewalkW = way("sw", "footway", [["w-200", [-8, -200]], ["wc", [-8, 0]], ["w200", [-8, 200]]]);
const sidewalkE = way("se", "footway", [["e-200", [8, -200]], ["ec", [8, 0]], ["e200", [8, 200]]]);
/** Passagen delar nod "R" med vägen (mitt på passagen = hazardindex 1). */
const zebra = way("zebra", "footway", [["wc", [-8, 0]], ["R", [0, 0]], ["ec", [8, 0]]], { hazard: [1], tags: { footway: "crossing" } });
const build = (ways: TileWay[], act: "walk" | "mtb" = "walk") => buildRegionGraph(ways, act, ORIGIN, 1500, ORIGIN);
/** Båda punkterna ligger på nätet (inom 2 m) och i samma sammanhängande del. buildRegionGraph behåller bara delen närmast start. */
const connected = (g: ReturnType<typeof indexGraph>, a: P, b: P) => {
  const sa = snapToGraph(g, ll(a)), sb = snapToGraph(g, ll(b));
  if (!sa || !sb || sa.offNetworkM > 2 || sb.offNetworkM > 2) return false;
  return g.edges.get(sa.edgeId)!.component === g.edges.get(sb.edgeId)!.component;
};
function zombieOn(g: ReturnType<typeof indexGraph>, p: P): Zombie {
  const s = snapToGraph(g, ll(p))!;
  return { id: "zt", edgeId: s.edgeId, distanceAlongEdgeM: s.distM, speedMps: 1.7, state: "patrol", dir: 1, route: [], stateSinceS: 0, replanAtS: 0, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false };
}

describe("gångpassager över större väg (spelnät mot rutt-nät)", () => {
  it("rutt-nätet förbinder aldrig de två sidorna, spelnätet gör det via passagen", () => {
    const r = build([sidewalkW, sidewalkE, zebra]);
    expect(connected(indexGraph(r.graph), [-8, 100], [8, 100])).toBe(false);
    const play = indexGraph({ ...r.play.graph, crossingNodes: [...r.play.crossingNodes] });
    expect(connected(play, [-8, 100], [8, 100])).toBe(true);
    expect(r.play.crossingNodes.has("R")).toBe(true);
    expect(r.play.components).toBe(1);
  });

  it("en passage som är kartlagd som två halvor (möts vid vägen) förbinds, en ensam stig som tar slut vid vägen gör det inte", () => {
    const halfW = way("hw", "footway", [["wc", [-8, 0]], ["R", [0, 0]]], { hazard: [1] });
    const halfE = way("he", "footway", [["R", [0, 0]], ["ec", [8, 0]]], { hazard: [0] });
    const two = build([sidewalkW, sidewalkE, halfW, halfE]);
    expect(connected(indexGraph({ ...two.play.graph, crossingNodes: [...two.play.crossingNodes] }), [-8, 100], [8, 100])).toBe(true);
    expect(connected(indexGraph(two.graph), [-8, 100], [8, 100])).toBe(false);
    // Bara västra halvan: stigen slutar vid vägen och förblir en återvändsgränd även i spelnätet.
    const lone = build([sidewalkW, sidewalkE, halfW]);
    expect(lone.play.crossingNodes.size).toBe(0);
    expect(connected(indexGraph({ ...lone.play.graph, crossingNodes: [] }), [-8, 100], [8, 100])).toBe(false);
  });

  it("en vanlig gata (residential) som korsar den större vägen blir inte en gångpassage", () => {
    const street = way("st", "residential", [["s-w", [-100, 20]], ["R2", [0, 20]], ["s-e", [100, 20]]], { hazard: [1] });
    const r = build([sidewalkW, sidewalkE, street]);
    expect(r.play.crossingNodes.size).toBe(0);
  });

  it("tunnel och bro som korsar en väg utan delad nod förbinds aldrig med korsande vägar", () => {
    // Gångtunnel under en gata (y = 0) och en gata ovanför: geometriskt korsning men inga delade nod-id.
    const tunnel = way("tun", "footway", [["t1", [-100, -4]], ["t2", [100, -4]]], { tags: { tunnel: "yes" } });
    const street = way("str", "residential", [["a1", [0, -100]], ["a2", [0, 100]]]);
    const r = build([tunnel, street]);
    expect(r.play.components).toBe(2);
    expect(indexGraph(r.play.graph).edges.size).toBeGreaterThan(0);
    // Bro (bridge=yes) över samma gata.
    const bridge = way("br", "footway", [["b1", [-100, 4]], ["b2", [100, 4]]], { tags: { bridge: "yes" } });
    const r2 = build([bridge, street]);
    expect(r2.play.components).toBe(2);
  });

  it("tunnel som är kopplad vid båda ändarna är en del av nätet (zombier kan gå igenom)", () => {
    const left = way("l", "footway", [["x0", [-300, 0]], ["t1", [-100, 0]]]);
    const tunnel = way("tun", "footway", [["t1", [-100, 0]], ["t2", [100, 0]]], { tags: { tunnel: "yes" } });
    const right = way("r", "footway", [["t2", [100, 0]], ["x1", [300, 0]]]);
    const r = build([left, tunnel, right]);
    expect(r.play.components).toBe(1);
    expect([...indexGraph(r.play.graph).edges.values()].find((e) => e.id.startsWith("tun"))!.grade).toBe("tunnel");
  });

  it("cykelväg utan foot=yes räknas inte som gångpassage för gående", () => {
    const cyc = way("cy", "cycleway", [["wc", [-8, 0]], ["R", [0, 0]], ["ec", [8, 0]]], { hazard: [1] });
    const r = build([sidewalkW, sidewalkE, cyc]);
    expect(r.play.crossingNodes.size).toBe(0);
  });
});

describe("hindertyp i tiles (hazardKinds) begränsar vilka passager som kopplas", () => {
  const withKind = (kind: string) => build([sidewalkW, sidewalkE, { ...zebra, hazardKinds: [kind] }]);
  it("secondary/tertiary (t) kopplas, motorväg/trunk/primary (T), järnväg (r) och vattendrag (w) kopplas inte", () => {
    expect(withKind("t").play.crossingNodes.has("R")).toBe(true);
    for (const k of ["T", "r", "w"]) expect(withKind(k).play.crossingNodes.size).toBe(0);
  });
  it("två halvor över en trunk-länk förblir klippta, över tertiary kopplas de", () => {
    const halves = (k: string) => build([sidewalkW, sidewalkE, { ...way("hw", "footway", [["wc", [-8, 0]], ["R", [0, 0]]], { hazard: [1] }), hazardKinds: [k] }, { ...way("he", "footway", [["R", [0, 0]], ["ec", [8, 0]]], { hazard: [0] }), hazardKinds: [k] }]);
    expect(halves("t").play.crossingNodes.has("R")).toBe(true);
    expect(halves("T").play.crossingNodes.size).toBe(0);
  });
  it("utan hindertyp (äldre tiles) gäller strukturregeln som förut", () => {
    expect(build([sidewalkW, sidewalkE, zebra]).play.crossingNodes.has("R")).toBe(true);
  });
  it("hindertypen följer med när en enkelriktad cykelstig vänds (reverse)", () => {
    const z = { ...way("zr", "footway", [["wc", [-8, 0]], ["R", [0, 0]], ["ec", [8, 0]]], { hazard: [1] }), hazardKinds: ["T"] };
    expect(build([sidewalkW, sidewalkE, z], "mtb").play.crossingNodes.size).toBe(0);
  });
});

describe("infektion kräver att zombien kan nå spelaren", () => {
  const r = build([sidewalkW, sidewalkE, zebra]);
  const g = indexGraph({ ...r.play.graph, crossingNodes: [...r.play.crossingNodes] });
  const zombieAt = (p: P) => { const s = snapToGraph(g, ll(p))!; return { edgeId: s.edgeId, distanceAlongEdgeM: s.distM }; };
  const snapAt = (p: P) => { const s = snapToGraph(g, ll(p))!; return { edgeId: s.edgeId, distM: s.distM }; };

  it("zombie på andra sidan vägen (16 m fågelvägen, 400+ m att gå) smittar inte", () => {
    const player = ll([-8, 100]);
    expect(haversineM(ll([8, 100]), player)).toBeCloseTo(16, 0);
    expect(infectionContactM(g, player, snapAt([-8, 100]), [zombieAt([8, 100])])).toBe(Infinity);
  });
  it("zombie på samma trottoar och vid själva passagen smittar", () => {
    expect(infectionContactM(g, ll([-8, 100]), snapAt([-8, 100]), [zombieAt([-8, 110])])).toBeCloseTo(10, 0);
    // Vid passagen är vägen mellan dem kort.
    expect(infectionContactM(g, ll([-8, 3]), snapAt([-8, 3]), [zombieAt([8, 3])])).toBeLessThan(20);
  });
  it("spelare utanför nätet: avståndet till nätet räknas in", () => {
    // 15 m väster om västra trottoaren; zombie på trottoaren rakt öster: 15 m fågelvägen, 15 m att gå.
    const player = ll([-23, 100]);
    expect(infectionContactM(g, player, snapAt([-23, 100]), [zombieAt([-8, 100])])).toBeCloseTo(15, 0);
  });
  it("utan nätposition för spelaren används fågelvägen", () => {
    expect(infectionContactM(g, ll([-8, 100]), null, [zombieAt([8, 100])])).toBeCloseTo(16, 0);
  });

  it("i motorn: en zombie tvärs över vägen får aldrig smitta spelaren, men en på samma sida gör det", () => {
    const rules = { ...resolveRules("walk", "normal", 3000), headStartS: 0, initialZombies: 1, maxZombies: 1, magnetic: false, detectionRadiusM: 0, revealIntervalS: 1e9 };
    const player = ll([-8, 100]);
    const run = (zp: P) => {
      const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 1, rulesVersion: RULES_VERSION }, rules, start: player });
      const z = zombieOn(g, zp);
      z.speedMps = 0;
      state.zombies = [z];
      for (let i = 0; i < 60 / STEP_S && state.result === undefined; i++) stepGame(g, state, rules, { position: player, quality: "ok", accuracyM: 5 });
      return state.result;
    };
    expect(run([8, 100])).toBeUndefined();
    expect(run([-8, 110])).toBe("infected");
  });
});

describe("zombier följer spelaren över en kartlagd passage", () => {
  it("jagande zombie på andra sidan tar sig över passagen och når spelaren", () => {
    const r = build([sidewalkW, sidewalkE, zebra]);
    const g = indexGraph({ ...r.play.graph, crossingNodes: [...r.play.crossingNodes] });
    const rules = { ...resolveRules("walk", "normal", 3000), headStartS: 0, initialZombies: 1, maxZombies: 1 };
    const player = ll([-8, 60]);
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 2, rulesVersion: RULES_VERSION }, rules, start: player });
    const z = zombieOn(g, [8, 60]);
    state.zombies = [z];
    let crossed = false;
    let maxJump = 0;
    let prev = zombieLatLon(g, z);
    for (let i = 0; i < 400 / STEP_S && state.result === undefined; i++) {
      stepGame(g, state, rules, { position: player, quality: "ok", accuracyM: 5 });
      const now = zombieLatLon(g, z);
      maxJump = Math.max(maxJump, haversineM(prev, now));
      prev = now;
      if (haversineM(now, ll([0, 0])) < 3) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(state.result).toBe("infected");
    // Ingen teleportering: aldrig mer än en stegs rörelse (inkl. spurt).
    expect(maxJump).toBeLessThanOrEqual(rules.zombieSpeedMps * rules.sprintSpeedFactor * STEP_S + 0.05);
  });

  it("utan passage (bara rutt-nätet) kan zombien aldrig ta sig över", () => {
    const r = build([sidewalkW, sidewalkE]);
    expect(r.play.components).toBe(2);
  });
});

describe("val av extraction och position på rätt nivå", () => {
  it("extraction placeras aldrig vid eller bortom en passage", () => {
    const r = build([sidewalkW, sidewalkE, zebra]);
    const g = indexGraph({ ...r.play.graph, crossingNodes: [...r.play.crossingNodes] });
    const player = snapToGraph(g, ll([-8, -150]))!;
    const comp = g.edges.get(player.edgeId)!.component;
    for (let seed = 1; seed <= 20; seed++) {
      const id = chooseExtraction(g, { playerPos: player, component: comp, zombiePositions: [], remainingS: 1800, playerPaceMps: 1.3 }, { rngState: seed });
      if (id === null) continue;
      expect(g.crossingNodes.has(id)).toBe(false);
      const n = g.nodes.get(id)!;
      expect(n.lon).toBeLessThan(ORIGIN.lon); // alltid på spelarens (västra) sida
    }
  });

  it("position hålls på bron/marken man redan är på när två vägar ligger nästan i samma läge", () => {
    // Bro (y = 0) över en gångväg (y = -4) som korsar den; punkten mitt emellan.
    const bridge = way("br", "footway", [["b1", [-100, 0]], ["b2", [100, 0]]], { tags: { bridge: "yes" } });
    const ground = way("gr", "footway", [["g1", [-100, -4]], ["g2", [100, -4]]]);
    // Ändarna är sammanlänkade (annars behåller grafen bara en av dem).
    const links = [way("l1", "footway", [["b1", [-100, 0]], ["g1", [-100, -4]]]), way("l2", "footway", [["b2", [100, 0]], ["g2", [100, -4]]])];
    const g = indexGraph(build([bridge, ground, ...links]).play.graph);
    const p = ll([10, -2.2]); // närmast marken (1,8 m) men bara 2,2 m från bron
    const plain = snapToGraph(g, p)!;
    expect(g.edges.get(plain.edgeId)!.id.startsWith("gr")).toBe(true);
    const onBridge = { edgeId: [...g.edges.values()].find((e) => e.grade === "bridge")!.id, distM: 110 };
    // Delar ingen nod med marknivån: kontinuitetsregeln gäller bara samma eller angränsande kant, så bron behålls bara om den var föregående.
    expect(snapToGraphNear(g, p, undefined, onBridge)!.edgeId).toBe(onBridge.edgeId);
    expect(snapToGraphNear(g, p, undefined, null)!.edgeId).toBe(plain.edgeId);
    // Klart närmare marken (mer än marginalen, här 10 m): marken vinner trots att bron var föregående kant.
    const far = indexGraph(build([bridge, way("gr2", "footway", [["g1", [-100, -12]], ["g2", [100, -12]]]), way("l1", "footway", [["b1", [-100, 0]], ["g1", [-100, -12]]]), way("l2", "footway", [["b2", [100, 0]], ["g2", [100, -12]]])]).play.graph);
    const prevBridge = { edgeId: [...far.edges.values()].find((e) => e.grade === "bridge")!.id, distM: 110 };
    const q = ll([10, -11]);
    expect(far.edges.get(snapToGraphNear(far, q, undefined, prevBridge)!.edgeId)!.grade).toBeUndefined();
  });
});

describe("riktiga Värmlandsdata: centrala Karlstad", () => {
  const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
  const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
  const CENTRE = { lat: 59.3793, lon: 13.5036 };

  it("spelnätet binder ihop många fler gångvägar än rutt-nätet (zombier fastnar inte på en ö)", async () => {
    const store = new TileStore("/data/v1/varmland", fsFetch);
    const { ways } = await store.loadAround(CENTRE, 2500);
    const r = buildRegionGraph(ways, "walk", CENTRE, 2500, CENTRE);
    expect(r.play.crossingNodes.size).toBeGreaterThan(50);
    expect(r.play.componentKm).toBeGreaterThan(r.stats.componentKm * 1.4);
    expect(r.play.components).toBeLessThan(r.stats.components);
    // Rutt-nätet är oförändrat: samma hazard-ändnoder som tidigare, så inga förslag korsar en större väg.
    expect(r.hazardNodes.size).toBeGreaterThan(100);
  });

  it("simulerad match på spelnätet: ingen zombie hoppar mer än en stegs rörelse, och passager används", async () => {
    const prep = await prepareMatch(new TileStore("/data/v1/varmland", fsFetch), CENTRE, { ...withActivity(defaultParams("walk"), "walk"), mode: "survival", seed: 4 });
    expect(prep.status).toBe("ok");
    const g = prep.graph!;
    expect(g.crossingNodes.size).toBeGreaterThan(0);
    let crossed = 0;
    for (const seed of [1, 2, 3]) {
      const sim = new SimSession({ g, activity: "walk", difficulty: "hard", durationS: 900, seed, strategy: "random", start: CENTRE });
      const prev = new Map(sim.state.zombies.map((z) => [z.id, zombieLatLon(g, z)]));
      const maxStep = sim.rules.zombieSpeedMps * sim.rules.sprintSpeedFactor * STEP_S + 0.05;
      for (let i = 0; i < 900 / STEP_S && !sim.finished; i++) {
        sim.step();
        for (const z of sim.state.zombies) {
          const now = zombieLatLon(g, z);
          const before = prev.get(z.id);
          if (before) expect(haversineM(before, now)).toBeLessThanOrEqual(maxStep);
          prev.set(z.id, now);
          const e = g.edges.get(z.edgeId)!;
          if (e.crossing) crossed++;
        }
      }
    }
    expect(crossed).toBeGreaterThan(0); // zombierna rör sig över passager i riktig data
  }, 120000);
});

describe("spelare utanför nätet", () => {
  const r = build([sidewalkW, sidewalkE, zebra]);
  const g = indexGraph({ ...r.play.graph, crossingNodes: [...r.play.crossingNodes] });
  const rules = { ...resolveRules("walk", "normal", 3000), headStartS: 0, initialZombies: 1, maxZombies: 1 };
  const setup = (player: P, zombie: P) => {
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 5, rulesVersion: RULES_VERSION }, rules, start: ll([-8, 100]) });
    state.zombies = [zombieOn(g, zombie)];
    state.player.position = ll(player);
    return state;
  };

  it("zombien går till närmaste punkt på nätet, står inte kvar långt bort, och smittar inte på 60 m avstånd", () => {
    const player = ll([-68, 100]); // 60 m väster om västra trottoaren
    const state = setup([-68, 100], [8, 180]);
    const target = ll([-8, 100]);
    let dist = Infinity;
    for (let i = 0; i < 240 / STEP_S; i++) {
      stepGame(g, state, rules, { position: player, quality: "ok", accuracyM: 5 });
      dist = haversineM(zombieLatLon(g, state.zombies[0]), target);
    }
    expect(state.result).toBeUndefined();
    expect(dist).toBeLessThan(25); // framme vid (eller strax intill) närmaste nätpunkt, inte kvar på andra sidan vägen
    expect(["chase", "intercept"]).toContain(state.zombies[0].state);
    expect(haversineM(zombieLatLon(g, state.zombies[0]), player)).toBeGreaterThan(40);
  });

  it("kliver spelaren tillbaka på nätet fortsätter jakten och smittan fungerar igen", () => {
    const state = setup([-68, 100], [-8, 160]);
    for (let i = 0; i < 120 / STEP_S; i++) stepGame(g, state, rules, { position: ll([-68, 100]), quality: "ok", accuracyM: 5 });
    expect(state.result).toBeUndefined();
    for (let i = 0; i < 60 / STEP_S && state.result === undefined; i++) stepGame(g, state, rules, { position: ll([-8, 100]), quality: "ok", accuracyM: 5 });
    expect(state.result).toBe("infected");
  });
});
