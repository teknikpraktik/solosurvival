import { haversineM, cumulativeLengths, pointAlong } from "@/geo/geometry";
import type { TrailGraph } from "@/geo/graph/types";
import type { RouteProposal, Waypoint } from "./types";

/** Önskat avstånd mellan checkpoints i Mission (m). */
export const CHECKPOINT_SPACING_M = 500;
/** Same on Bike (mtb): one checkpoint per km is enough. */
export const CHECKPOINT_SPACING_BIKE_M = 1000;

/**
 * Mission med ett checkpoint per ca 500 m: lägger checkpoints jämnt fördelade längs den genererade slingan (i körordning)
 * och behåller hemkomsten sist. Slingans form ändras inte; de ursprungliga vändpunkterna ersätts av jämnt utspridda punkter längs samma väg.
 */
export function densifyCheckpoints(g: TrailGraph, p: RouteProposal, spacingM = CHECKPOINT_SPACING_M): RouteProposal {
  if (p.mode !== "mission") return p;
  const home = p.waypoints.find((w) => w.kind === "home");
  const cum = cumulativeLengths(p.geometry);
  const total = cum.at(-1) ?? 0;
  if (!home || total < 2 * spacingM) return p;
  const n = Math.max(1, Math.floor((total - spacingM / 2) / spacingM));
  const nodes = [...new Set(p.edgeIds)].flatMap((id) => { const e = g.edges.get(id)!; return [e.from, e.to]; });
  const cps: Waypoint[] = [];
  for (let i = 1; i <= n; i++) {
    const ll = pointAlong(p.geometry, cum, (i * total) / (n + 1));
    let best = nodes[0], bd = Infinity;
    for (const id of nodes) { const d = haversineM(g.nodes.get(id)!, ll); if (d < bd) { bd = d; best = id; } }
    cps.push({ id: `C${i}`, kind: "checkpoint", nodeId: best, lat: ll.lat, lon: ll.lon });
  }
  return { ...p, waypoints: [...cps, home] };
}
