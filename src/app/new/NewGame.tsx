"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "../_client/Modal";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import type { GameMode } from "@/engine/objectives/objectives";
import { DISTANCE_LIMITS, DURATION_LIMITS, START_MAX_ACCURACY_M, clampParams, defaultParams, withActivity, type MatchParams } from "@/play/config";
import { haversineM } from "@/geo/geometry";
import { errorText } from "@/gps/provider/provider";
import { matchDurationS } from "@/play/match";
import {
  NEW_GAME_ACTIVITIES, NEW_GAME_MODES, chooseActivity, chooseMode, courseKey, loadSetup, needsCourse, paramsFromSetup, prevStep, saveSetup,
  stepFromSearch, stepUrl, type Step,
} from "@/play/newgame-flow";
import { ACTIVITY_LABEL, DIFFICULTY_LABEL, MODE_LABEL, fmtKm } from "../_client/format";
import { REGENERATE_SVG } from "../_client/symbols";
import { t } from "../_client/strings";
import type { MapMarker } from "../_client/GameMap";
import { unlockAudio } from "../_client/cues";
import { preloadMatchPictures } from "../_client/matchImages";
import { useSessionCtx, useSessionView } from "../_client/SessionProvider";

const GameMap = dynamic(() => import("../_client/GameMap"), { ssr: false });

interface Opt<T extends string> { v: T; t: string }

/** Difficulty on the setup step, always shown (nothing to expand): a labelled row of toggle buttons (the chosen one has a red accent, a check mark and `aria-pressed`;
 * `aria-label` keeps the CSS check mark out of the button's name). */
function Choice<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: Opt<T>[]; onChange: (v: T) => void }) {
  return (
    <section className="ngsec">
      <h2 className="nglabel" id={`${id}-label`}>{label}</h2>
      <div className="opts seg" role="group" aria-labelledby={`${id}-label`}>
        {options.map((o) => (
          <button key={o.v} type="button" className="opt" aria-pressed={value === o.v} aria-label={o.t} onClick={() => onChange(o.v)}>
            <span className="opttitle">{o.t}</span>
          </button>
        ))}
      </div>
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

/**
 * A large picture card on the first two steps. One tap chooses and moves on. Its name is the title, the subtitle its description and
 * the earlier choice `aria-current`. The picture is a CSS background (decorative: no alt text, nothing read twice); if the file is
 * missing the card keeps its dark gradient and no broken-image icon can appear.
 */
function ImageCard({ id, card, title, sub, current, onClick }: { id: string; card: string; title: string; sub?: string; current: boolean; onClick: () => void }) {
  return (
    <button type="button" className="imgcard" data-card={card} data-current={current || undefined} aria-current={current || undefined}
      aria-labelledby={`${id}-title`} aria-describedby={sub ? `${id}-sub` : undefined} onClick={onClick}>
      <span className="imgcard-bg" aria-hidden="true" />
      <span className="imgcard-text">
        <span className="imgcard-title" id={`${id}-title`}>{title}</span>
        {sub && <span className="imgcard-sub" id={`${id}-sub`}>{sub}</span>}
      </span>
      {current && <span className="imgcard-mark" aria-hidden="true">✓</span>}
    </button>
  );
}

/** The header of the first two steps: the back chevron (out of New game on the first step, one step back on the second) and the title. */
function StepHeader({ title, onBack, backLabel }: { title: string; onBack?: () => void; backLabel?: string }) {
  if (!onBack) return <PageHeader title={title} />;
  return (
    <div className="topbar">
      <button type="button" className="pageback" aria-label={backLabel} onClick={onBack}><span aria-hidden="true">‹</span></button>
      <h1 style={{ flex: 1 }}>{title}</h1>
    </div>
  );
}

const km1 = (m: number) => `${(Math.round(m / 100) / 10).toFixed(1)} km`;
/** Time limit in the preview: hours and minutes (the game counts down to the second). */
const fmtHM = (s: number) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const newSeed = () => Math.floor(Math.random() * 1e9);
const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
/** A changed course distance plans a new course once the slider has rested this long (not on every step of a drag). */
const DISTANCE_SETTLE_MS = 450;

export default function NewGame() {
  const ctx = useSessionCtx();
  const router = useRouter();
  const session = ctx?.session;
  const view = useSessionView(session);
  const [p, setP] = useState<MatchParams>(() => defaultParams("walk"));
  const [step, setStep] = useState<Step>("activity");
  const [busy, setBusy] = useState(false);
  // Pressing START: keep the setup on screen until /play has taken over.
  const [starting, setStarting] = useState(false);
  // A TO B på terräng: varför senaste tryckta B avvisades (vatten, byggnad, större väg, järnväg).
  const [pickProblem, setPickProblem] = useState<string | null>(null);
  // The step each step was pushed from in this visit: back goes through the browser history only when that is the step before.
  const arrivedFrom = useRef<Partial<Record<Step, Step>>>({});

  // --- Steps in the URL (/new, /new?step=mode, /new?step=setup), so the phone's back button goes one step back ---
  const go = useCallback((to: Step, how: "push" | "replace" = "push") => {
    const url = stepUrl(to);
    if (how === "push") {
      setStep((from) => { arrivedFrom.current[to] = from; return to; });
      window.history.pushState(null, "", url);
    } else {
      window.history.replaceState(null, "", url);
      setStep(to);
    }
    window.scrollTo(0, 0);
  }, []);
  const back = () => {
    const prev = prevStep(step);
    if (!prev) { router.push("/"); return; }
    if (arrivedFrom.current[step] === prev) window.history.back();
    else go(prev, "replace");
  };
  useEffect(() => {
    // The last valid setup is the starting point of the choices (the cards show it as current); it is not offered as a separate shortcut.
    const s = loadSetup(storage());
    if (s) setP(paramsFromSetup(s));
    setStep(stepFromSearch(window.location.search));
    const onPop = () => { arrivedFrom.current = {}; setStep(stepFromSearch(window.location.search)); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Course preview: the parts of the map covered by the top bar and the panel (so the course is fitted into the rest).
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

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  // Survival plans its area when START is pressed (there is no course to look at), then starts at once.
  const startWith = (params: MatchParams) => run(async () => {
    unlockAudio();
    void session!.enableCompass(); // iOS asks for motion sensors only from a tap: the game itself starts without another one
    const r = await session!.prepare(clampParams({ ...params, pointA: null, seed: newSeed() }));
    if (r?.status !== "ok") return;
    setStarting(true);
    if (await session!.startMatch()) { saveSetup(storage(), params); router.push("/play"); }
    else setStarting(false);
  });

  useEffect(() => {
    if (!session) return;
    if (session.getView().stage === "finished") session.reset();
    session.startLocating();
    // PLAY AGAIN: the same settings on the setup step. Checkpoints plans a new course there, A to B picks B again, Survival starts at once (as before).
    const again = session.takeAgain();
    if (again) {
      const next = clampParams({ ...again, pointA: null, pointB: again.mode === "escape" ? null : again.pointB });
      setP(next);
      go("setup", "replace");
      if (next.mode === "survival" && session.currentStart()) startWith(next);
    }
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const stage = view?.stage ?? "idle";
  const prepared = view?.prepared ?? null;
  const proposal = prepared?.proposals[view?.selected ?? 0] ?? null;
  const set = (patch: Partial<MatchParams>) => setP((cur) => clampParams({ ...cur, ...patch }));
  const haveStart = !!session?.currentStart();
  // The match's pictures (helicopter cards, its possible endings) start loading on the setup step, before START.
  useEffect(() => { if (step === "setup") preloadMatchPictures(p.mode); }, [step, p.mode]);

  // --- Choices: another activity or mode drops a course planned for the old one (and any answer still on its way) ---
  const pickActivity = (a: Activity) => {
    const next = chooseActivity(p, a);
    if (next !== p) { setP(next); setPickProblem(null); session?.backToConfig(); }
    go("mode");
  };
  const pickMode = (m: GameMode) => {
    const next = chooseMode(p, m);
    if (next !== p) { setP(next); setPickProblem(null); session?.backToConfig(); }
    go("setup");
  };

  // --- The course on the setup step ---
  // A course is shown and can be started only when it was planned for exactly these choices.
  const key = courseKey(p);
  const preparedKey = view?.params ? courseKey(view.params) : null;
  const fresh = !!prepared && preparedKey === key && (stage === "preview" || stage === "preparing");
  const wantCourse = step === "setup" && needsCourse(p);
  // Plans a course when none fits the choices and none is on its way for them. prepare() marks itself as planning these choices at once,
  // so this does not ask twice; an answer for older choices is discarded by the session.
  useEffect(() => {
    if (!session || !wantCourse || starting || !haveStart) return;
    if (prepared && preparedKey === key) return; // planned (or being planned again) for these choices
    if (stage === "preparing" && preparedKey === key) return; // on its way
    const delay = p.mode === "mission" && prepared ? DISTANCE_SETTLE_MS : 0;
    const timer = setTimeout(() => { void session.prepare(clampParams({ ...p, pointA: null, seed: newSeed() })); }, delay);
    return () => clearTimeout(timer);
  }, [session, wantCourse, key, preparedKey, haveStart, stage, starting, !!prepared]); // eslint-disable-line react-hooks/exhaustive-deps

  // Location details are not shown to the player: only a short note when something needs attention.
  const gps = useMemo(() => {
    if (!view) return null;
    if (view.gpsError) return { tone: "bad", text: errorText[view.gpsError.code] };
    if (view.accuracyM === null) return { tone: "warn", text: t().newGame.gpsFinding };
    if (view.accuracyM > START_MAX_ACCURACY_M) return { tone: "warn", text: t().newGame.gpsWaiting };
    return null;
  }, [view]);

  const S = t().newGame;

  // ---------- Step 1: activity ----------
  if (step === "activity") {
    return (
      <main className="page newgame ngstep">
        <StepHeader title={S.title} />
        <p className="ngprompt">{S.activityPrompt}</p>
        <div className="imgcards two">
          {(NEW_GAME_ACTIVITIES as ("walk" | "mtb")[]).map((a) => (
            <ImageCard key={a} id={`act-${a}`} card={a === "mtb" ? "bike" : "foot"} title={S.activityCard[a]} sub={S.activitySub[a]} current={p.activity === a} onClick={() => pickActivity(a)} />
          ))}
        </div>
        {!ctx && <div className="muted">{S.loading}</div>}
      </main>
    );
  }

  // ---------- Step 2: mode ----------
  if (step === "mode") {
    const card: Record<GameMode, string> = { mission: "checkpoints", escape: "atob", survival: "survival" };
    return (
      <main className="page newgame ngstep">
        <StepHeader title={S.modeTitle} onBack={back} backLabel={S.backTo.activity} />
        <p className="ngprompt"><span className="ngprompt-k">{ACTIVITY_LABEL[p.activity]}</span> · {S.modePrompt}</p>
        <div className="imgcards three">
          {NEW_GAME_MODES.map((m) => (
            <ImageCard key={m} id={`mode-${m}`} card={card[m]} title={MODE_LABEL[m]} sub={S.modeWin[m]} current={p.mode === m} onClick={() => pickMode(m)} />
          ))}
        </div>
      </main>
    );
  }

  // ---------- Step 3: setup with the map ----------
  const P = t().preview;
  const K = t().pick;
  const isAB = p.mode === "escape";
  const isSurvival = p.mode === "survival";
  const status = fresh ? prepared?.status : undefined;
  const ok = status === "ok" || status === "alternative";
  const loading = wantCourse && !(fresh && stage === "preview") && (stage === "preparing" || haveStart);
  const failed = fresh && stage === "preview" && !!prepared && !ok;
  const limit = DISTANCE_LIMITS[p.activity];
  const dur = DURATION_LIMITS[p.activity];
  // A TO B: any way goes, so only a faint straight line between A and B is drawn (not the shortest path).
  const abA = fresh ? (view?.params?.pointA ?? null) : null;
  const abB = fresh ? (proposal?.waypoints[0] ?? null) : null;
  const showCourse = fresh && stage === "preview" && ok && !!proposal;
  const routes = isAB && showCourse && abA && abB ? [{ points: [abA, { lat: abB.lat, lon: abB.lon }], selected: false, faint: true }] : [];
  // Same markers as in the game: numbered checkpoints in the game's order, B, and the green home (start and return are the same place).
  const markers: MapMarker[] = [];
  if (isAB) {
    const a = abA ?? view?.position ?? null;
    if (a) markers.push({ id: "A", label: "A", lat: a.lat, lon: a.lon, tone: "done" });
    if (p.pointB) markers.push({ id: "B", label: "B", lat: p.pointB.lat, lon: p.pointB.lon, tone: "next" });
  } else if (showCourse && proposal) {
    proposal.waypoints.forEach((w, i) => markers.push({ id: w.id, label: w.kind === "home" ? "" : String(i + 1), lat: w.lat, lon: w.lon, tone: "todo", icon: w.kind === "home" ? "home" : undefined }));
  }
  const fitPts = showCourse && proposal
    ? (isAB && abA && abB ? [abA, { lat: abB.lat, lon: abB.lon }] : proposal.waypoints.map((w) => ({ lat: w.lat, lon: w.lon })).concat(view?.position ? [view.position] : []))
    : null;

  // Checkpoints and A TO B: the planned distance and the time limit, in one row (from the prepared course and the same functions the game
  // uses). Survival has none: its time limit is the match length chosen just above.
  const summary: { k: string; v: string }[] | null = !isSurvival && showCourse && proposal ? [
    { k: P.distance, v: fmtKm(isAB && abA && abB ? haversineM(abA, abB) : proposal.lengthM) },
    { k: P.timeLimit, v: fmtHM(matchDurationS(p, proposal)) },
  ] : null;
  const title = isAB ? (p.pointB ? K.bSet : K.tapForB) : isSurvival ? P.yourMatch : P.yourCourse;

  const canStart = isSurvival
    ? haveStart && !busy && !starting && stage !== "preparing"
    : showCourse && !view?.movedFromPreview && haveStart && !busy && !starting;
  const start = () => {
    if (isSurvival) { startWith(p); return; }
    void run(async () => {
      unlockAudio();
      void session!.enableCompass();
      setStarting(true);
      session!.setDifficulty(p.difficulty); // difficulty changes no course, so it was not part of the planning
      if (await session!.startMatch()) { saveSetup(storage(), p); router.push("/play"); }
      else setStarting(false);
    });
  };
  let note: ReactNode = null;
  if (!view) note = <div className="card" role="status">{S.loading}</div>;
  else if (failed) note = (
    <div className="card bad">
      {prepared!.message}
      {prepared!.alternatives?.includes("walk") && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" disabled={busy} onClick={() => run(() => session!.regenerate())}>TRY FROM MY POSITION</button>
          <button className="btn" disabled={busy} onClick={() => { setP(clampParams({ ...withActivity(p, "walk") })); session!.backToConfig(); }}>SWITCH TO WALKING</button>
        </div>
      )}
    </div>
  );
  else if (wantCourse && !haveStart && !fresh) note = <div className="card" role="status">{S.waitingForCourse}</div>;
  else if (loading) note = <div className="card" role="status">{P.loading}</div>;

  return (
    <div className="map-shell preview ngsetup">
      <GameMap
        graph={showCourse ? prepared?.graph : undefined}
        routes={routes}
        markers={markers}
        player={view?.position ?? null}
        accuracyM={view?.accuracyM ?? null}
        zoom={14}
        fit={fitPts}
        fitInsets={previewInsets}
        refitKey={sheetH}
        validatePick={isAB ? p.activity !== "mtb" : undefined}
        onPickRejected={isAB ? setPickProblem : undefined}
        onPick={isAB ? (pt) => { if (busy || starting) return; setPickProblem(null); set({ pointB: pt }); } : undefined}
      />
      <div className="hudbar pvtop" ref={topRef}>
        <div className="line ngchips">
          <button className="backbtn" aria-label={S.backTo.mode} disabled={busy || starting} onClick={back}>
            <span aria-hidden="true">‹</span>
          </button>
          <button className="backbtn ngchip" aria-label={S.changeActivity(ACTIVITY_LABEL[p.activity])} disabled={busy || starting} onClick={() => go("activity")}>
            {ACTIVITY_LABEL[p.activity]}
          </button>
          <button className="backbtn ngchip" aria-label={S.changeMode(MODE_LABEL[p.mode])} disabled={busy || starting} onClick={() => go("mode")}>
            {MODE_LABEL[p.mode]}
          </button>
        </div>
      </div>
      <div className="sheet pvsheet ngpanel" ref={sheetRef} data-testid={isAB ? "pickmap" : undefined}>
        <div className="pvhead">
          <div>
            <div className="pvkicker">{MODE_LABEL[p.mode]} · {ACTIVITY_LABEL[p.activity]}</div>
            <h2 className="pvtitle">{title}</h2>
          </div>
        </div>
        {gps && <div className={`card ${gps.tone}`} role="status">{gps.text}</div>}
        {isAB && pickProblem && <div className="card warn" role="status">{pickProblem}</div>}
        <div id="ngsettings" className="ngsettings">
          <Choice<Difficulty> id="difficulty" label={S.difficulty} value={p.difficulty} onChange={(difficulty) => set({ difficulty })}
            options={(["easy", "normal", "hard"] as Difficulty[]).map((d) => ({ v: d, t: DIFFICULTY_LABEL[d] }))} />
          {isSurvival ? (
            <RangeField id="dur" label={S.matchLength} shown={`${Math.round(p.durationS / 60)} min`} min={dur.minMin} max={dur.maxMin} step={dur.stepMin} value={Math.round(p.durationS / 60)}
              onChange={(v) => set({ durationS: v * 60 })} />
          ) : p.mode === "mission" ? (
            <RangeField id="dist" label={S.courseDistance} shown={km1(p.targetLengthM)} min={limit.min} max={limit.max} step={limit.step} value={p.targetLengthM}
              onChange={(v) => set({ targetLengthM: v })} />
          ) : null}
        </div>
        {note}
        {fresh && stage === "preview" && prepared?.status === "ok" && prepared.notes.some((n) => n.startsWith("easy-bike-network")) && <div className="card warn">Few easy gravel roads or bike lanes here, so the route may include rougher trails.</div>}
        {fresh && stage === "preview" && prepared?.status === "alternative" && <div className="card warn">{prepared.message}</div>}
        {summary && (
          <dl className="pvstats two">
            {summary.map((c) => <div key={c.k}><dt>{c.k}</dt><dd>{c.v}</dd></div>)}
          </dl>
        )}
        {fresh && view?.movedFromPreview && (
          <div className="card warn">
            {isAB ? `You have moved ${view.distToPreviewStartM ?? "?"} m from A. Update the route from your position.` : "You have moved from the start point. Update the route."}
            <button className="link" style={{ display: "block" }} onClick={() => { session!.backToConfig(); }}>{isAB ? "Update A to my position" : "Update the route"}</button>
          </div>
        )}
        {view?.messages.map((m) => <div key={m} className="card warn">{m}</div>)}
        <div className="pvactions">
          {p.mode === "mission" && (
            <button className="btn pvregen" aria-label={P.regenerateLabel} disabled={busy || starting || !fresh || stage === "preparing"} onClick={() => run(() => session!.regenerate())}>
              <span className="regenicon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: REGENERATE_SVG }} />{P.regenerate}
            </button>
          )}
          <button className="btn primary big cta pvstart" disabled={!canStart} onClick={start}>
            {isSurvival && (busy || starting) ? S.loadingMap : P.startGame}
          </button>
        </div>
      </div>
    </div>
  );
}
