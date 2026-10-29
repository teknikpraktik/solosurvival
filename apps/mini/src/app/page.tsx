"use client";
import dynamic from "next/dynamic";
import { useMemo, version } from "react";
import { SimSession } from "@/sim/runner";
import { gridGraph } from "@/sim/test-graphs";
import { edgeLatLon } from "@/geo/graph/graph";
const GameMap = dynamic(() => import("@/app/_client/GameMap"), { ssr: false });
export default function Page() {
  const r = useMemo(() => {
    const g = gridGraph(8, 8, 120);
    const s = new SimSession({ g, activity: "walk", difficulty: "easy", durationS: 300, seed: 1, strategy: "avoid", start: edgeLatLon(g, { edgeId: "r4:3", distM: 60 }) });
    for (let i = 0; i < 500 && !s.finished; i++) s.step();
    return { t: s.state.elapsedSeconds, z: s.state.zombies.length, g };
  }, []);
  return <main><p data-react={version}>spike t={r.t.toFixed(1)} zombies={r.z}</p><div style={{ height: 300, position: "relative" }}><GameMap graph={r.g} player={null} /></div></main>;
}
