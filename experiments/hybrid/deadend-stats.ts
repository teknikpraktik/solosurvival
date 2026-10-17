import { AREAS } from "./areas";
import { areaCtx } from "./lib/experiment";
for (const a of AREAS) for (const act of ["run", "mtb"] as const) {
  const c = areaCtx(a.id, act);
  const g = c.ag.trailIndexed;
  let tot = 0, de = 0;
  for (const e of g.edges.values()) { tot += e.lengthM; if (c.deadEndEdges.has(e.id)) de += e.lengthM; }
  const oneway = [...g.edges.values()].filter((e) => e.oneway).length;
  console.log(`${a.name.padEnd(11)} ${act.padEnd(4)} återvändsgrenar: ${(de / tot * 100).toFixed(1)} % av stiglängden (${(de / 1000).toFixed(1)} av ${(tot / 1000).toFixed(1)} km), ${[...c.deadEndEdges].length}/${g.edges.size} kanter, enkelriktade kanter: ${oneway}`);
}
