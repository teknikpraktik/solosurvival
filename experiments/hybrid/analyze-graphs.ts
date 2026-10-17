import { AREAS } from "./areas";
import { loadAreaGraph } from "./lib/graphs";
import { buildRaster, C, classAt, coverage } from "./lib/raster";
import { buildHybridGraph, DEFAULT_HYBRID } from "./lib/hybrid-graph";
import { toLocal } from "@/geo/geometry";
import { gzipSync } from "node:zlib";

const acts = ["run", "mtb"] as const;
for (const a of AREAS) {
  for (const act of acts) {
    const ag = loadAreaGraph(a.id, act);
    const g = ag.trailIndexed;
    const raster = buildRaster(ag.fx);
    const comp = g.components[0];
    const km = comp.lengthM / 1000;
    // Rimlighetskontroll: andel av stigpunkter som ligger i vatten/byggnad enligt rastret.
    let n = 0, bad = 0;
    for (const e of g.edges.values()) for (const p of e.geometry) { const l = toLocal(ag.fx.origin, p); const c = classAt(raster, l.x, l.y); n++; if (c === C.WATER || c === C.BUILDING) bad++; }
    console.log(`\n${a.name} / ${act}: ${g.nodes.size} noder, ${g.edges.size} kanter, ${km.toFixed(1)} km, ${comp.junctionCount} korsningar (bortfiltrerat: ${ag.dropped.outsideBox} utanför ruta, ${ag.dropped.smallComponents} i småkomponenter)`);
    console.log(`  stigpunkter i vatten/byggnad enligt raster: ${bad}/${n} (${((bad / n) * 100).toFixed(2)} %)`);
    for (const maxLinkM of [100, 150]) {
      const h = buildHybridGraph(ag.trail, ag.fx, raster, { ...DEFAULT_HYBRID, maxLinkM });
      const st = h.stats;
      console.log(`  hybrid ≤${maxLinkM} m: ankare ${st.anchors}, kandidater ${st.candidatePairs}, ej nytta ${st.rejectedNoBenefit}, terräng ${st.rejectedTerrain} ${JSON.stringify(st.rejectedByClass)}, länkar ${st.links}, längd p50/p90 ${st.linkLengthM.p50.toFixed(0)}/${st.linkLengthM.p90.toFixed(0)} m, ${st.buildMs.toFixed(0)} ms, ${(st.bytesJson / 1e3).toFixed(0)} kB (gz ${(gzipSync(JSON.stringify(h.graph)).length / 1e3).toFixed(0)} kB)`);
    }
  }
}
