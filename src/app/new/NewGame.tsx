"use client";

import dynamic from "next/dynamic";
import { CloseButton, PageHeader } from "../_client/Modal";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import type { GameMode } from "@/engine/objectives/objectives";
import { extractionOpensAtS } from "@/config/game-rules";
import { DISTANCE_LIMITS, DURATION_LIMITS, START_MAX_ACCURACY_M, clampParams, defaultParams, withActivity, type MatchParams } from "@/play/config";
import { estimatedMinutes } from "@/play/prepare";
import { COURSE_DETOUR_FACTOR } from "@/routes/course";
import { haversineM } from "@/geo/geometry";
import { errorText } from "@/gps/provider/provider";
import { matchDurationS } from "@/play/match";
import { ACTIVITY_LABEL, DIFFICULTY_LABEL, MODE_LABEL, fmtKm, fmtTime } from "../_client/format";
import { BIKE_SVG, MODE_ATOB_SVG, MODE_CHECKPOINTS_SVG, MODE_SURVIVAL_SVG, WALK_SVG } from "../_client/symbols";
import { t } from "../_client/strings";
import { resolveModeRules } from "@/config/modes";
import { applyEnemySpeedMultiplier } from "@/config/game-rules";
import type { MapMarker } from "../_client/GameMap";
import { unlockAudio } from "../_client/cues";
import { useSessionCtx, useSessionView } from "../_client/SessionProvider";

const GameMap = dynamic(() => import("../_client/GameMap"), { ssr: false });

interface Opt<T extends string> { v: T; t: string; sub?: string; icon?: string }

/**
 * One choice on New game (mode, activity, difficulty): a labelled group of toggle buttons. The chosen one has a red accent, a thicker
 * border and a check mark (not colour alone), and `aria-pressed`. `cards` = icon, title and subtitle stacked; `row` = icon and title side by side.
 */
function Choice<T extends string>({ id, label, value, options, onChange, variant, children }: { id: string; label: string; value: T; options: Opt<T>[]; onChange: (v: T) => void; variant: "cards" | "row" | "seg"; children?: ReactNode }) {
  return (
    <section className="ngsec">
      <h2 className="nglabel" id={`${id}-label`}>{label}</h2>
      <div className={`opts ${variant}`} role="group" aria-labelledby={`${id}-label`}>
        {options.map((o) => (
          <button key={o.v} type="button" className="opt" aria-pressed={value === o.v} aria-label={o.t} aria-describedby={o.sub ? `${id}-${o.v}-sub` : undefined} onClick={() => onChange(o.v)}>
            {o.icon && <span className="opticon" dangerouslySetInnerHTML={{ __html: o.icon }} />}
            <span className="opttitle">{o.t}</span>
            {o.sub && <span className="optsub" id={`${id}-${o.v}-sub`}>{o.sub}</span>}
          </button>
        ))}
      </div>
      {children}
    </section>
  );
}

/** A slider with its value to the right of the heading, Short/Long under the ends and a short note. */
function RangeField({ id, label, shown, min, max, step, value, onChange, note }: { id: string; label: string; shown: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; note: string }) {
  const S = t().newGame;
  return (
    <section className="ngsec">
      <div className="rangehead">
        <label className="nglabel" htmlFor={id}>{label}</label>
        <output className="rangeval" htmlFor={id}>{shown}</output>
      </div>
      <div className="rangerow">
        <span aria-hidden="true">{S.short}</span>
        <input id={id} className="ngrange" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={shown} />
        <span aria-hidden="true">{S.long}</span>
      </div>
      <p className="ngnote">{note}</p>
    </section>
  );
}

const MODE_ICON: Record<GameMode, string> = { mission: MODE_CHECKPOINTS_SVG, escape: MODE_ATOB_SVG, survival: MODE_SURVIVAL_SVG };
const km1 = (m: number) => `${(Math.round(m / 100) / 10).toFixed(1)} km`;

export default function NewGame() {
  const ctx = useSessionCtx();
  const router = useRouter();
  const session = ctx?.session;
  const view = useSessionView(session);
  const [p, setP] = useState<MatchParams>(() => defaultParams("walk"));
  const [busy, setBusy] = useState(false);
  // Pressing START: keep showing the preview until /play has taken over (otherwise the settings form flashes while the stage changes).
  const [starting, setStarting] = useState(false);
  // A TO B på terräng: varför senaste tryckta B avvisades (vatten, byggnad, större väg, järnväg).
  const [pickProblem, setPickProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    if (session.getView().stage === "finished") session.reset();
    session.startLocating();
  }, [session]);

  const stage = view?.stage ?? "idle";
  const preview = stage === "preview" || stage === "preparing";
  const prepared = view?.prepared ?? null;
  const proposal = prepared?.proposals[view?.selected ?? 0] ?? null;
  const set = (patch: Partial<MatchParams>) => setP((cur) => clampParams({ ...cur, ...patch }));

  // Location details are not shown to the player: only a short note when something needs attention.
  const gps = useMemo(() => {
    if (!view) return null;
    if (view.gpsError) return { tone: "bad", text: errorText[view.gpsError.code] };
    if (view.accuracyM === null) return { tone: "warn", text: t().newGame.gpsFinding };
    if (view.accuracyM > START_MAX_ACCURACY_M) return { tone: "warn", text: t().newGame.gpsWaiting };
    return null;
  }, [view]);

  const isAB = p.mode === "escape";
  const canPrepare = !!session?.currentStart() && (!isAB || !!p.pointB) && !busy && stage !== "preparing";
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const limit = DISTANCE_LIMITS[p.activity];
  const dur = DURATION_LIMITS[p.activity];
  // A TO B: any way goes, so only a faint straight line between A and B is drawn (not the shortest path).
  const abA = view?.params?.pointA ?? null;
  const abB = proposal?.waypoints[0] ?? null;
  const routes = isAB
    ? (abA && abB ? [{ points: [abA, { lat: abB.lat, lon: abB.lon }], selected: false, faint: true }] : [])
    : []; // Mission: no route line, only the numbered checkpoints
  const markers: MapMarker[] = proposal ? proposal.waypoints.filter((w) => w.kind !== "home").map((w, i) => ({ id: w.id, label: w.kind === "destination" ? "B" : String(i + 1), lat: w.lat, lon: w.lon, tone: "todo" as const })) : [];
  if (proposal && isAB && view?.params?.pointA) markers.push({ id: "A", label: "A", lat: view.params.pointA.lat, lon: view.params.pointA.lon, tone: "done" });

  // Survival has no course to look at (the area is the same whatever you choose), so START on the settings page goes straight into the game.
  // The preview is only shown if preparing failed (it carries the message and the alternatives).
  const direct = p.mode === "survival";
  const startDirect = () => run(async () => {
    unlockAudio();
    const r = await session!.prepare(clampParams({ ...p, seed: Math.floor(Math.random() * 1e9) }));
    if (r?.status !== "ok") return;
    setStarting(true);
    if (await session!.startMatch()) router.push("/play");
    else setStarting(false);
  });

  if ((preview || starting) && view && !(direct && (busy || starting))) {
    const status = prepared?.status;
    const ok = status === "ok" || status === "alternative";
    return (
      <div className="map-shell">
        <GameMap graph={prepared?.graph} routes={routes} markers={markers} start={session?.currentStart()} player={view.position} accuracyM={view.accuracyM} fit={isAB && abA && abB ? [abA, { lat: abB.lat, lon: abB.lon }] : proposal?.geometry ?? (view.position ? [view.position] : null)} />
        <div className="hudbar"><div className="line"><span className="pill">{MODE_LABEL[p.mode]} · {ACTIVITY_LABEL[p.activity]}</span><CloseButton label="Close preview" disabled={busy || starting} onClick={() => session!.backToConfig()} /></div></div>
        <div className="sheet">
          {stage === "preparing" && <div className="card">Loading map data and planning…</div>}
          {stage !== "preparing" && prepared && !ok && (
            <div className="card bad">
              {prepared.message}
              {prepared.alternatives?.includes("walk") && (
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn" disabled={busy} onClick={() => run(() => session!.regenerate())}>TRY FROM MY POSITION</button>
                  <button className="btn" disabled={busy} onClick={() => { const next = withActivity(view.params ?? p, "walk"); setP(next); void run(() => session!.prepare(next)); }}>SWITCH TO WALKING</button>
                </div>
              )}
            </div>
          )}
          {stage !== "preparing" && prepared?.status === "ok" && prepared.notes.some((n) => n.startsWith("easy-bike-network")) && <div className="card warn">Few easy gravel roads or bike lanes here, so the route may include rougher trails.</div>}
          {stage !== "preparing" && prepared?.status === "alternative" && <div className="card warn">{prepared.message}</div>}
          {stage !== "preparing" && ok && proposal && (
            <>
              <div className="stat"><span>{isAB ? "Straight line" : "Distance (straight lines)"}</span><b>{fmtKm(isAB && abA && abB ? haversineM(abA, abB) : proposal.lengthM)}</b></div>
              <div className="stat"><span>Estimated time</span><b>about {estimatedMinutes(proposal.lengthM * (p.mode === "mission" || proposal.terrain ? COURSE_DETOUR_FACTOR : 1), p)} min</b></div>
              <div className="stat"><span>Time limit</span><b>{fmtTime(matchDurationS(p, proposal))}</b></div>
              <div className="stat"><span>Goal</span><b>{p.mode === "escape" ? "Point B – any route" : `${proposal.waypoints.filter((w) => w.kind === "checkpoint").length} checkpoints + home`}</b></div>
              {proposal.quality.flags.length > 0 && <div className="muted">{proposal.quality.flags.join(" · ")}</div>}
            </>
          )}
          {stage !== "preparing" && ok && p.mode === "survival" && (
            <>
              <div className="stat"><span>Match length</span><b>{fmtTime(p.durationS)}</b></div>
              <div className="muted">Survival has no route. Move freely along the trails. Extraction opens after {Math.round(extractionOpensAtS(p.durationS) / 60)} min; reach it before the time runs out.</div>
            </>
          )}
          {view.movedFromPreview && (
            <div className="card warn">
              {isAB ? `You have moved ${view.distToPreviewStartM ?? "?"} m from A. Update the route from your position.` : "You have moved from the start point. Update the route."}
              {isAB && <button className="link" style={{ display: "block" }} onClick={() => run(() => session!.prepare({ ...(view.params ?? p), pointA: null }))}>Update A to my position</button>}
            </div>
          )}
          {view.messages.map((m) => <div key={m} className="card warn">{m}</div>)}
          <div className="muted">{isAB ? (proposal?.terrain ? "Walk any way you like to B, on trails or across country. The line is only a hint. Zombies run on trails and walk slowly across country. The game does not know about roads, railways, water or private land: never cross them just because the game suggests it." : "Any route you like counts. The line is only a hint. Never cross a road or railway just because the game suggests it.") : p.mode === "mission" ? "Fetch the numbered checkpoints in order, then return home. Choose your own way. Never cross a road or railway just because the game suggests it." : "Never cross a road or railway just because the game suggests it."}</div>
          <div className="row">
            {!isAB && <button className="btn" disabled={busy || stage === "preparing"} onClick={() => run(() => session!.regenerate())}>{p.mode === "survival" ? "TRY AGAIN" : "NEW COURSE"}</button>}
          </div>
          <button
            className="btn primary big"
            disabled={!ok || stage === "preparing" || view.movedFromPreview || !session!.currentStart() || starting}
            onClick={() => run(async () => { unlockAudio(); setStarting(true); if (await session!.startMatch()) router.push("/play"); else setStarting(false); })}
          >
            START
          </button>
        </div>
      </div>
    );
  }

  const S = t().newGame;
  // Difficulty line from the rules this match would get (zombie speed and how many at most), never a made-up description.
  const rules = applyEnemySpeedMultiplier(resolveModeRules(p.mode, p.activity, p.difficulty, p.durationS), p.enemySpeedMultiplier);
  const steps = direct ? [S.steps.setup, S.steps.start] : [S.steps.setup, S.steps.preview, S.steps.start];
  return (
    <main className="page newgame">
      <PageHeader title={S.title} />
      <ol className="steps" aria-label="Steps">
        {steps.map((x, i) => <li key={x} aria-current={i === 0 ? "step" : undefined}><span>{i + 1}</span>{x}</li>)}
      </ol>
      {gps && <div className={`card ${gps.tone}`} role="status">{gps.text}</div>}
      <Choice<GameMode> id="mode" label={S.mode} variant="cards" value={p.mode} onChange={(mode) => set({ mode })}
        options={(["mission", "escape", "survival"] as GameMode[]).map((m) => ({ v: m, t: MODE_LABEL[m], sub: S.modeSubtitle[m], icon: MODE_ICON[m] }))} />
      <Choice<Activity> id="activity" label={S.activity} variant="row" value={p.activity} onChange={(a) => setP(withActivity(p, a))}
        options={(["walk", "mtb"] as Activity[]).map((a) => ({ v: a, t: ACTIVITY_LABEL[a], icon: a === "mtb" ? BIKE_SVG : WALK_SVG }))} />
      <Choice<Difficulty> id="difficulty" label={S.difficulty} variant="seg" value={p.difficulty} onChange={(difficulty) => set({ difficulty })}
        options={(["easy", "normal", "hard"] as Difficulty[]).map((d) => ({ v: d, t: DIFFICULTY_LABEL[d] }))}>
        <p className="ngnote" aria-live="polite">{S.difficultyLine(p.difficulty, (rules.zombieSpeedMps * 3.6).toFixed(1), rules.maxZombies)}</p>
      </Choice>
      {p.mode === "survival" ? (
        <RangeField id="dur" label={S.matchLength} shown={`${Math.round(p.durationS / 60)} min`} min={dur.minMin} max={dur.maxMin} step={dur.stepMin} value={Math.round(p.durationS / 60)}
          onChange={(v) => set({ durationS: v * 60 })} note={S.extractionNote(Math.round(extractionOpensAtS(p.durationS) / 60))} />
      ) : p.mode === "mission" ? (
        <RangeField id="dist" label={S.courseDistance} shown={km1(p.targetLengthM)} min={limit.min} max={limit.max} step={limit.step} value={p.targetLengthM}
          onChange={(v) => set({ targetLengthM: v })} note={S.courseNote} />
      ) : (
        <section className="ngsec">
          <h2 className="nglabel">{S.destination}</h2>
          <div className="stat"><span>{S.pointA}</span><b>{S.pointAValue}</b></div>
          <div className="stat"><span>{S.pointB}</span><b>{p.pointB ? S.pointBPicked : S.pointBTap}</b></div>
          <div className="pickmap" data-testid="pickmap">
            <GameMap
              zoom={14}
              player={view?.position}
              accuracyM={view?.accuracyM}
              fit={view?.position && p.pointB ? [view.position, p.pointB] : null}
              markers={[...(view?.position ? [{ id: "A", label: "A", lat: view.position.lat, lon: view.position.lon, tone: "done" as const }] : []), ...(p.pointB ? [{ id: "B", label: "B", lat: p.pointB.lat, lon: p.pointB.lon, tone: "next" as const }] : [])]}
              validatePick={p.activity !== "mtb"}
              onPickRejected={setPickProblem}
              onPick={(pt) => { setPickProblem(null); set({ pointB: pt }); }}
            />
          </div>
          {pickProblem && <div className="card warn" role="status">{pickProblem}</div>}
        </section>
      )}
      <div className="ngfoot">
        <button className="btn primary big" disabled={!canPrepare || starting} onClick={direct ? startDirect : () => run(async () => { unlockAudio(); await session!.prepare(clampParams({ ...p, seed: Math.floor(Math.random() * 1e9) })); })}>
          {direct ? (busy || starting ? S.loadingMap : S.start) : isAB && !p.pointB ? S.pickB : isAB ? S.showRoute : S.showCourse}
        </button>
      </div>
      {!ctx && <div className="muted">{S.loading}</div>}
    </main>
  );
}
