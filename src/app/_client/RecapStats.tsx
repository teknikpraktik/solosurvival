import type { Activity } from "@/config/activities";
import type { RecapStats } from "@/play/recap";
import { fmtKm, fmtTime } from "./format";

const kmh = (mps: number) => `${(mps * 3.6).toFixed(1)} km/h`;

/** The numbers after a match (end-of-match dialog and the match page). Rows with nothing to say are left out. */
export function RecapStatsList({ stats, elapsedS, distanceM, activity }: { stats: RecapStats; elapsedS: number; distanceM: number; activity: Activity }) {
  const bike = activity === "mtb";
  return (
    <>
      <div className="stat"><span>Match time</span><b>{fmtTime(elapsedS)}</b></div>
      <div className="stat"><span>Distance moved</span><b>{fmtKm(distanceM)}</b></div>
      {stats.movingS >= 30 && <div className="stat"><span>Moving · average speed</span><b>{fmtTime(stats.movingS)} · {kmh(distanceM / stats.movingS)}</b></div>}
      {stats.maxSpeedMps > 0.5 && <div className="stat"><span>Top speed</span><b>{kmh(stats.maxSpeedMps)}</b></div>}
      {stats.closestM !== null && <div className="stat"><span>Closest zombie</span><b>{stats.closestM} m{stats.closestAtS !== null ? ` at ${fmtTime(stats.closestAtS)}` : ""}</b></div>}
      {stats.nearMisses > 0 && <div className="stat"><span>Close calls (zombie within reach)</span><b>{stats.nearMisses}</b></div>}
      {bike && stats.passThroughs > 0 && <div className="stat"><span>Zombies ridden through</span><b>{stats.passThroughs}</b></div>}
      <div className="stat"><span>Time with a zombie within 100 m</span><b>{fmtTime(stats.dangerS)}</b></div>
      {stats.sprints > 0 && <div className="stat"><span>Zombie sprints</span><b>{stats.sprints}</b></div>}
      {bike && stats.offNetworkS >= 1 && <div className="stat"><span>Off the road network</span><b>{fmtTime(stats.offNetworkS)}</b></div>}
      {stats.peakZombies > 0 && <div className="stat"><span>Most zombies at once</span><b>{stats.peakZombies}</b></div>}
    </>
  );
}
