import { cumulativeLengths, fromLocal, haversineM, pointAlong, toLocal, type LatLon } from "../geometry";
import type { GraphNode, RawEdge, SerializedGraph } from "./types";
import { GRAPH_VERSION } from "./graph";

/**
 * Terrängnät för A TO B till fots: ett regelbundet gitter av syntetiska kanter (`offtrail`) i en korridor kring linjen A–B.
 * Zombier är bundna till grafen; utan stigar eller längs mellanrum mellan dem ger gittret dem något att gå på, långsammare än på stig.
 * - Gittret ligger längs A–B (u) och tvärs (v), 8 grannar (rakt och diagonalt), så sträckor blir högst ca 8 % längre än fågelvägen.
 * - Avståndet mellan noder anpassas efter ytan (högst `maxNodes` noder, 45–70 m). Med 8 grannar ligger varje punkt i korridoren
 *   högst ca 0,2 × avståndet från närmaste kant, alltså under infektionsradien, så en spelare mitt i en gitterruta kan alltid nås.
 * - Stigar (om sådana finns) behålls oförändrade och kopplas till gittret vid varje stignod som ligger inom 0,8 × avståndet från en gitternod.
 * Gittret vet inget om vatten, vägar eller byggnader; zombier går alltså över dem. Spelaren väljer själv sin väg och kan inte föras dit av spelet.
 */
export interface TerrainMeshOptions {
  a: LatLon;
  b: LatLon;
  /** Halv bredd (m) på korridoren. */
  halfWidthM?: number;
  /** Förlängning (m) bortom A och B. */
  marginM?: number;
  maxNodes?: number;
}

export interface TerrainMesh {
  graph: SerializedGraph;
  spacingM: number;
  meshNodes: number;
  meshEdges: number;
  trailEdges: number;
  links: number;
}

export const MESH_MIN_SPACING_M = 45;
export const MESH_MAX_SPACING_M = 70;
export const MESH_HALF_WIDTH_M = 700;
export const MESH_MARGIN_M = 500;
export const MESH_MAX_NODES = 7000;
/** Långa stigkanter delas så här (m) så att zombier kan gå på och av stigen var som helst, inte bara i dess ändar. */
export const TRAIL_CHUNK_M = 120;

const NEIGHBOURS: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function buildTerrainMesh(trails: SerializedGraph | null, o: TerrainMeshOptions): TerrainMesh {
  const margin = o.marginM ?? MESH_MARGIN_M;
  const maxNodes = o.maxNodes ?? MESH_MAX_NODES;
  const L = haversineM(o.a, o.b);
  const ab = toLocal(o.a, o.b);
  const len = Math.hypot(ab.x, ab.y) || 1;
  const ux = ab.x / len, uy = ab.y / len; // längs A–B
  const vx = -uy, vy = ux; // tvärs
  let W = o.halfWidthM ?? MESH_HALF_WIDTH_M;
  const uLen = L + 2 * margin;
  // Spacing from the area; if even the coarsest lattice would be too big, narrow the corridor.
  let s = Math.min(MESH_MAX_SPACING_M, Math.max(MESH_MIN_SPACING_M, Math.sqrt((uLen * 2 * W) / maxNodes)));
  if ((uLen / s + 1) * ((2 * W) / s + 1) > maxNodes) W = Math.max(150, ((maxNodes * s * s) / uLen - s * 2) / 2);
  const nu = Math.floor(uLen / s) + 1, nv = Math.floor((2 * W) / s) + 1;
  const at = (i: number, j: number): LatLon => {
    const u = -margin + i * s, v = -W + j * s;
    return fromLocal(o.a, { x: u * ux + v * vx, y: u * uy + v * vy });
  };
  const id = (i: number, j: number) => `T${i}_${j}`;

  const nodes: GraphNode[] = [];
  const grid: LatLon[][] = [];
  for (let i = 0; i < nu; i++) {
    grid.push([]);
    for (let j = 0; j < nv; j++) {
      const p = at(i, j);
      grid[i].push(p);
      nodes.push({ id: id(i, j), lat: p.lat, lon: p.lon });
    }
  }
  const edges: RawEdge[] = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    for (const [di, dj] of NEIGHBOURS) {
      const i2 = i + di, j2 = j + dj;
      if (i2 >= nu || j2 < 0 || j2 >= nv) continue;
      edges.push({ id: `T:${i}_${j}>${i2}_${j2}`, from: id(i, j), to: id(i2, j2), geometry: [grid[i][j], grid[i2][j2]], type: "other", offtrail: true });
    }
  }
  const meshEdges = edges.length;

  // Stigar: behåll dem som ligger i korridoren och koppla stignoder till närmaste gitternod.
  let trailEdges = 0, links = 0;
  const trailNodes = new Map<string, GraphNode>();
  const inRect = (p: LatLon, pad = 0) => {
    const l = toLocal(o.a, p);
    const u = l.x * ux + l.y * uy, v = l.x * vx + l.y * vy;
    return u >= -margin - pad && u <= L + margin + pad && Math.abs(v) <= W + pad;
  };
  if (trails) {
    const byId = new Map(trails.nodes.map((n) => [n.id, n]));
    for (const e of trails.edges) {
      const mid = e.geometry[Math.floor(e.geometry.length / 2)];
      if (!inRect(mid)) continue;
      for (const part of splitEdge(e, byId, trailNodes)) { edges.push(part); trailEdges++; }
      for (const nid of [e.from, e.to]) if (!trailNodes.has(nid) && byId.has(nid)) trailNodes.set(nid, byId.get(nid)!);
    }
    for (const n of trailNodes.values()) {
      if (!inRect(n)) continue;
      const l = toLocal(o.a, n);
      const u = l.x * ux + l.y * uy, v = l.x * vx + l.y * vy;
      const i = Math.round((u + margin) / s), j = Math.round((v + W) / s);
      if (i < 0 || i >= nu || j < 0 || j >= nv) continue;
      const d = haversineM(n, grid[i][j]);
      if (d > 0.8 * s) continue;
      edges.push({ id: `TL:${n.id}`, from: n.id, to: id(i, j), geometry: d > 0.5 ? [{ lat: n.lat, lon: n.lon }, grid[i][j]] : [{ lat: n.lat, lon: n.lon }, { lat: n.lat + 1e-6, lon: n.lon }], type: "other", offtrail: true });
      links++;
    }
  }
  const allNodes = [...nodes, ...trailNodes.values()];
  return { graph: { graphVersion: GRAPH_VERSION, source: "terrain-mesh", nodes: allNodes, edges, crossingNodes: trails?.crossingNodes?.filter((n) => trailNodes.has(n)) }, spacingM: s, meshNodes: nodes.length, meshEdges, trailEdges, links };
}

/** Delar en lång stigkant i bitar om högst `TRAIL_CHUNK_M` (nya noder läggs i `nodes`); korta kanter returneras oförändrade. */
function splitEdge(e: RawEdge, byId: Map<string, GraphNode>, nodes: Map<string, GraphNode>): RawEdge[] {
  const cum = cumulativeLengths(e.geometry);
  const L = cum[cum.length - 1];
  const k = Math.ceil(L / TRAIL_CHUNK_M);
  if (k <= 1 || !byId.has(e.from) || !byId.has(e.to)) return [e];
  const ids = [e.from];
  const cuts: LatLon[] = [e.geometry[0]];
  for (let i = 1; i < k; i++) {
    const p = pointAlong(e.geometry, cum, (L * i) / k);
    const id = `${e.id}~${i}`;
    nodes.set(id, { id, lat: p.lat, lon: p.lon });
    ids.push(id);
    cuts.push(p);
  }
  ids.push(e.to);
  cuts.push(e.geometry[e.geometry.length - 1]);
  const out: RawEdge[] = [];
  for (let i = 0; i < k; i++) {
    const d0 = (L * i) / k, d1 = (L * (i + 1)) / k;
    const inner = e.geometry.filter((_, j) => cum[j] > d0 && cum[j] < d1);
    out.push({ ...e, id: `${e.id}~${i}`, from: ids[i], to: ids[i + 1], geometry: [cuts[i], ...inner, cuts[i + 1]] });
  }
  return out;
}
