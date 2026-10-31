"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "../_client/Modal";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { ACTIVITY_LABEL, DIFFICULTY_LABEL, MODE_LABEL, fmtKm } from "../_client/format";
import { BIKE_SVG, MODE_ATOB_SVG, MODE_CHECKPOINTS_SVG, MODE_SURVIVAL_SVG, REGENERATE_SVG, WALK_SVG } from "../_client/symbols";
import { t } from "../_client/strings";
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
function RangeField({ id, label, shown, min, max, step, value, onChange, note }: { id: string; label: string; shown: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; note?: string }) {
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
      {note && <p className="ngnote">{note}</p>}
    </section>
  );
}

const MODE_ICON: Record<GameMode, string> = { mission: MODE_CHECKPOINTS_SVG, escape: MODE_ATOB_SVG, survival: MODE_SURVIVAL_SVG };
const km1 = (m: number) => `${(Math.round(m / 100) / 10).toFixed(1)} km`;
/** Time limit in the preview: hours and minutes (the game counts down to the second). */
const fmtHM = (s: number) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

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
  // Course preview (and A to B's map for B): the parts of the map covered by the top bar and the panel (so the course is fitted into the rest).
  // A to B: SHOW COURSE first opens a full map to set B on.
  const [picking, setPicking] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetH, setSheetH] = useState(0);
  const previewInsets = useCallback(() => {
    // Measured against the map itself, which may reach below the visible screen (see .map-shell in globals.css).
    const map = sheetRef.current?.parentElement?.querySelector(".maplibregl-map, .map-canvas")?.getBoundingClientRect() ?? sheetRef.current?.parentElement?.getBoundingClientRect();
    const top = topRef.current?.getBoundingClientRect();
    const sheet = sheetRef.current?.getBoundingClientRect();
    if (!map) return { top: 0, bottom: 0 };
    if (!sheet) return { top: top ? top.bottom - map.top : 0, bottom: 0 };
    // Landscape: the panel is a column on the right, not a sheet at the bottom.
    const side = sheet.left > map.left + 8;
    return { top: top ? top.bottom - map.top : 0, bottom: side ? 0 : map.bottom - sheet.top, right: side ? map.right - sheet.left : 0 };
  }, []);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSheetH(Math.round(el.getBoundingClientRect().height / 8) * 8)); // ignore sub-pixel changes
    ro.observe(el);
    return () => ro.disconnect();
  });

  useEffect(() => {
    if (!session) return;
    if (session.getView().stage === "finished") session.reset();
    session.startLocating();
    // PLAY AGAIN: the same settings with a new course. A to B starts from here, so B is picked again; the others go straight to the preview.
    const again = session.takeAgain();
    if (again) {
      const next = clampParams(again.mode === "escape" ? { ...again, pointB: null } : again);
      setP(next);
      if (next.mode === "mission" && session.currentStart()) void run(() => session.prepare(next));
      else if (next.mode === "survival" && session.currentStart()) startWith(next);
    }
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const canPrepare = (isAB || !!session?.currentStart()) && !busy && stage !== "preparing";
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const limit = DISTANCE_LIMITS[p.activity];
  const dur = DURATION_LIMITS[p.activity];
  // A TO B: any way goes, so only a faint straight line between A and B is drawn (not the shortest path).
  const abA = view?.params?.pointA ?? null;
  const abB = proposal?.waypoints[0] ?? null;
  const routes = isAB
    ? (abA && abB ? [{ points: [abA, { lat: abB.lat, lon: abB.lon }], selected: false, faint: true }] : [])
    : []; // Mission: no route line, only the numbered checkpoints
  // Same markers as in the game: numbered checkpoints in the game's order, B, and the green home (start and return are the same place).
  const markers: MapMarker[] = proposal ? proposal.waypoints.map((w, i) => ({ id: w.id, label: w.kind === "destination" ? "B" : w.kind === "home" ? "" : String(i + 1), lat: w.lat, lon: w.lon, tone: "todo" as const, icon: w.kind === "home" ? "home" as const : undefined })) : [];
  if (proposal && isAB && view?.params?.pointA) markers.push({ id: "A", label: "A", lat: view.params.pointA.lat, lon: view.params.pointA.lon, tone: "done" });

  // Survival has no course to look at (the area is the same whatever you choose), so START on the settings page goes straight into the game.
  // The preview is only shown if preparing failed (it carries the message and the alternatives).
  const direct = p.mode === "survival";
  const startWith = (params: MatchParams) => run(async () => {
    unlockAudio();
    const r = await session!.prepare(clampParams({ ...params, seed: Math.floor(Math.random() * 1e9) }));
    if (r?.status !== "ok") return;
    setStarting(true);
    if (await session!.startMatch()) router.push("/play");
    else setStarting(false);
  });
  const startDirect = () => startWith(p);

  if ((preview || starting) && view && !(direct && (busy || starting))) {
    const P = t().preview;
    const status = prepared?.status;
    const ok = status === "ok" || status === "alternative";
    const loading = stage === "preparing";
    const checkpoints = proposal ? proposal.waypoints.filter((w) => w.kind === "checkpoint").length : 0;
    const extractionMin = Math.round(extractionOpensAtS(p.durationS) / 60);
    // The three numbers, the time limit and the goal text for this mode (all from the prepared course and the same functions the game uses).
    type Cell = { k: string; v: string };
    const summary: { title: string; cells: Cell[]; limit: string } | null = !loading && ok && proposal ? {
      title: isAB ? P.yourRoute : P.yourCourse,
      cells: [
        { k: P.distance, v: fmtKm(isAB && abA && abB ? haversineM(abA, abB) : proposal.lengthM) },
        { k: P.estTime, v: P.minutes(estimatedMinutes(proposal.lengthM * (p.mode === "mission" || proposal.terrain ? COURSE_DETOUR_FACTOR : 1), p)) },
        isAB ? { k: P.goal, v: P.pointB } : { k: P.checkpoints, v: P.checkpointsValue(checkpoints) },
      ],
      limit: fmtHM(matchDurationS(p, proposal)),
    } : !loading && ok && p.mode === "survival" ? {
      title: P.yourMatch,
      cells: [{ k: P.matchLength, v: P.minutes(Math.round(p.durationS / 60)) }, { k: P.extraction, v: P.afterMin(extractionMin) }, { k: P.goal, v: P.reachExtraction }],
      limit: fmtHM(p.durationS),
    } : null;
    const fitPts = isAB && abA && abB ? [abA, { lat: abB.lat, lon: abB.lon }] : proposal ? proposal.waypoints.map((w) => ({ lat: w.lat, lon: w.lon })).concat(view.position ? [view.position] : []) : (view.position ? [view.position] : null);
    return (
      <div className="map-shell preview">
        <GameMap graph={prepared?.graph} routes={routes} markers={markers} player={view.position} accuracyM={view.accuracyM} fit={fitPts} fitInsets={previewInsets} refitKey={sheetH} />
        <div className="hudbar pvtop" ref={topRef}>
          <div className="line">
            <button className="backbtn" aria-label={P.editSetupLabel} disabled={busy || starting} onClick={() => session!.backToConfig()}>
              <span aria-hidden="true">‹</span> {P.editSetup}
            </button>
          </div>
        </div>
        <div className="sheet pvsheet" ref={sheetRef}>
          <div className="pvhead">
            <div>
              <div className="pvkicker">{MODE_LABEL[p.mode]} · {ACTIVITY_LABEL[p.activity]}</div>
              <h2 className="pvtitle">{summary?.title ?? P.yourCourse}</h2>
            </div>
          </div>
          {loading && <div className="card" role="status">{P.loading}</div>}
          {!loading && prepared && !ok && (
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
          {!loading && prepared?.status === "ok" && prepared.notes.some((n) => n.startsWith("easy-bike-network")) && <div className="card warn">Few easy gravel roads or bike lanes here, so the route may include rougher trails.</div>}
          {!loading && prepared?.status === "alternative" && <div className="card warn">{prepared.message}</div>}
          {summary && (
            <>
              <dl className="pvstats">
                {summary.cells.map((c) => <div key={c.k}><dt>{c.k}</dt><dd>{c.v}</dd></div>)}
              </dl>
              <div className="pvlimit"><span>{P.timeLimit}</span><b>{summary.limit}</b></div>
            </>
          )}
          {view.movedFromPreview && (
            <div className="card warn">
              {isAB ? `You have moved ${view.distToPreviewStartM ?? "?"} m from A. Update the route from your position.` : "You have moved from the start point. Update the route."}
              {isAB && <button className="link" style={{ display: "block" }} onClick={() => run(() => session!.prepare({ ...(view.params ?? p), pointA: null }))}>Update A to my position</button>}
            </div>
          )}
          {view.messages.map((m) => <div key={m} className="card warn">{m}</div>)}
          <div className="pvactions">
            {!isAB && (
              <button className="btn pvregen" aria-label={P.regenerateLabel} disabled={busy || loading} onClick={() => run(() => session!.regenerate())}>
                <span className="regenicon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: REGENERATE_SVG }} />{P.regenerate}
              </button>
            )}
            <button
              className="btn primary big cta pvstart"
              disabled={!ok || loading || view.movedFromPreview || !session!.currentStart() || starting}
              onClick={() => run(async () => { unlockAudio(); setStarting(true); if (await session!.startMatch()) router.push("/play"); else setStarting(false); })}
            >
              {P.startGame}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const S = t().newGame;
  // A to B, step 2: a full map to set B on (A is where the player is). SHOW COURSE then plans the route and opens the preview.
  if (picking && isAB && view) {
    const K = t().pick;
    return (
      <div className="map-shell preview pick">
        <GameMap
          zoom={14}
          player={view.position}
          accuracyM={view.accuracyM}
          markers={[...(view.position ? [{ id: "A", label: "A", lat: view.position.lat, lon: view.position.lon, tone: "done" as const }] : []), ...(p.pointB ? [{ id: "B", label: "B", lat: p.pointB.lat, lon: p.pointB.lon, tone: "next" as const }] : [])]}
          validatePick={p.activity !== "mtb"}
          onPickRejected={setPickProblem}
          onPick={(pt) => { setPickProblem(null); set({ pointB: pt }); }}
        />
        <div className="hudbar pvtop" ref={topRef}>
          <div className="line">
            <button className="backbtn" aria-label={t().preview.editSetupLabel} disabled={busy} onClick={() => { setPickProblem(null); setPicking(false); }}>
              <span aria-hidden="true">‹</span> {t().preview.editSetup}
            </button>
          </div>
        </div>
        <div className="sheet pvsheet" ref={sheetRef} data-testid="pickmap">
          <div className="pvhead">
            <div>
              <div className="pvkicker">{MODE_LABEL[p.mode]} · {ACTIVITY_LABEL[p.activity]}</div>
              <h2 className="pvtitle">{p.pointB ? K.bSet : K.tapForB}</h2>
            </div>
          </div>
          {gps && <div className={`card ${gps.tone}`} role="status">{gps.text}</div>}
          {pickProblem && <div className="card warn" role="status">{pickProblem}</div>}
          <div className="pvactions">
            <button className="btn primary big cta pvstart" disabled={!p.pointB || !session?.currentStart() || busy}
              onClick={() => run(async () => { unlockAudio(); await session!.prepare(clampParams({ ...p, pointA: null, seed: Math.floor(Math.random() * 1e9) })); setPicking(false); })}>
              {S.showCourse}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <main className="page newgame">
      <PageHeader title={S.title} />
      {gps && <div className={`card ${gps.tone}`} role="status">{gps.text}</div>}
      <Choice<GameMode> id="mode" label={S.mode} variant="cards" value={p.mode} onChange={(mode) => set({ mode })}
        options={(["mission", "escape", "survival"] as GameMode[]).map((m) => ({ v: m, t: MODE_LABEL[m], sub: S.modeSubtitle[m], icon: MODE_ICON[m] }))} />
      <Choice<Activity> id="activity" label={S.activity} variant="row" value={p.activity} onChange={(a) => setP(withActivity(p, a))}
        options={(["walk", "mtb"] as Activity[]).map((a) => ({ v: a, t: ACTIVITY_LABEL[a], icon: a === "mtb" ? BIKE_SVG : WALK_SVG }))} />
      <Choice<Difficulty> id="difficulty" label={S.difficulty} variant="seg" value={p.difficulty} onChange={(difficulty) => set({ difficulty })}
        options={(["easy", "normal", "hard"] as Difficulty[]).map((d) => ({ v: d, t: DIFFICULTY_LABEL[d] }))} />
      {p.mode === "survival" ? (
        <RangeField id="dur" label={S.matchLength} shown={`${Math.round(p.durationS / 60)} min`} min={dur.minMin} max={dur.maxMin} step={dur.stepMin} value={Math.round(p.durationS / 60)}
          onChange={(v) => set({ durationS: v * 60 })} note={S.extractionNote(Math.round(extractionOpensAtS(p.durationS) / 60))} />
      ) : p.mode === "mission" ? (
        <RangeField id="dist" label={S.courseDistance} shown={km1(p.targetLengthM)} min={limit.min} max={limit.max} step={limit.step} value={p.targetLengthM}
          onChange={(v) => set({ targetLengthM: v })} />
      ) : null}
      <div className="ngfoot">
        <button className="btn primary big cta" disabled={!canPrepare || starting} onClick={direct ? startDirect : isAB ? () => setPicking(true) : () => run(async () => { unlockAudio(); await session!.prepare(clampParams({ ...p, seed: Math.floor(Math.random() * 1e9) })); })}>
          {direct ? (busy || starting ? S.loadingMap : S.start) : S.showCourse}
        </button>
      </div>
      {!ctx && <div className="muted">{S.loading}</div>}
    </main>
  );
}
