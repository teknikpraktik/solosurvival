"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { PageHeader } from "../_client/Modal";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import type { GameMode } from "@/engine/objectives/objectives";
import { DISTANCE_LIMITS, DURATION_LIMITS, START_MAX_ACCURACY_M, START_WARN_ACCURACY_M, clampParams, defaultParams, withActivity, type MatchParams } from "@/play/config";
import { estimatedMinutes } from "@/play/prepare";
import { errorText } from "@/gps/provider/provider";
import { matchDurationS } from "@/play/match";
import { ACTIVITY_LABEL, DIFFICULTY_LABEL, MODE_HELP, MODE_LABEL, fmtKm, fmtTime } from "../_client/format";
import { cuesEnabled, setCuesEnabled, unlockAudio } from "../_client/cues";
import { useSessionCtx, useSessionView } from "../_client/SessionProvider";

const GameMap = dynamic(() => import("../_client/GameMap"), { ssr: false });

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; t: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => <button key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.t}</button>)}
      </div>
    </div>
  );
}

export default function NewGame() {
  const ctx = useSessionCtx();
  const router = useRouter();
  const session = ctx?.session;
  const view = useSessionView(session);
  const [p, setP] = useState<MatchParams>(() => defaultParams("walk"));
  const [cues, setCues] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCues(cuesEnabled()); }, []);
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

  const gps = useMemo(() => {
    if (!view) return { tone: "", text: "Startar…" };
    if (view.gpsError) return { tone: "bad", text: errorText[view.gpsError.code] };
    if (view.accuracyM === null) return { tone: "warn", text: "Söker position… Gå ut under bar himmel." };
    if (view.accuracyM > START_MAX_ACCURACY_M) return { tone: "warn", text: `Svag GPS (±${Math.round(view.accuracyM)} m). Vänta på bättre signal.` };
    if (view.accuracyM > START_WARN_ACCURACY_M) return { tone: "warn", text: `GPS ±${Math.round(view.accuracyM)} m – funkar, men bättre signal ger rättvisare spel.` };
    return { tone: "good", text: `GPS klar, ±${Math.round(view.accuracyM)} m.` };
  }, [view]);

  const canPrepare = !!session?.currentStart() && !busy && stage !== "preparing";
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const limit = DISTANCE_LIMITS[p.activity];
  const dur = DURATION_LIMITS[p.activity];
  const routes = (prepared?.proposals ?? []).map((r, i) => ({ points: r.geometry, selected: i === (view?.selected ?? 0) }));
  const markers = proposal ? proposal.waypoints.filter((w) => w.kind !== "home").map((w, i) => ({ id: w.id, label: w.kind === "destination" ? "B" : String(i + 1), lat: w.lat, lon: w.lon, tone: "todo" as const })) : [];

  if (preview && view) {
    const status = prepared?.status;
    const ok = status === "ok" || status === "alternative";
    return (
      <div className="map-shell">
        <GameMap graph={prepared?.graph} routes={routes} markers={markers} start={session?.currentStart()} player={view.position} accuracyM={view.accuracyM} fit={proposal?.geometry ?? (view.position ? [view.position] : null)} />
        <div className="hudbar"><div className="line"><span className="pill">{MODE_LABEL[p.mode]} · {ACTIVITY_LABEL[p.activity]}</span><Link className="pill" href="/">✕</Link></div></div>
        <div className="sheet">
          {stage === "preparing" && <div className="card">Hämtar kartdata och beräknar rutt…</div>}
          {stage !== "preparing" && prepared && !ok && <div className="card bad">{prepared.message}</div>}
          {stage !== "preparing" && prepared?.status === "alternative" && <div className="card warn">{prepared.message}</div>}
          {stage !== "preparing" && prepared && ok && p.mode !== "survival" && prepared.proposals.length > 1 && (
            <div className="chips" role="group" aria-label="Förslag">
              {prepared.proposals.map((r, i) => <button key={r.id} className="chip" aria-pressed={i === view.selected} onClick={() => session!.select(i)}>Förslag {i + 1}</button>)}
            </div>
          )}
          {stage !== "preparing" && ok && proposal && (
            <>
              <div className="stat"><span>Sträcka</span><b>{fmtKm(proposal.lengthM)}</b></div>
              <div className="stat"><span>Uppskattad tid</span><b>ca {estimatedMinutes(proposal.lengthM, p)} min</b></div>
              <div className="stat"><span>Tidsgräns</span><b>{fmtTime(matchDurationS(p, proposal))}</b></div>
              <div className="stat"><span>Mål</span><b>{p.mode === "escape" ? "Destination B" : `${proposal.waypoints.filter((w) => w.kind === "checkpoint").length} checkpoint(s) + hem`}</b></div>
              {proposal.quality.flags.length > 0 && <div className="muted">{proposal.quality.flags.join(" · ")}</div>}
            </>
          )}
          {stage !== "preparing" && ok && p.mode === "survival" && (
            <>
              <div className="stat"><span>Matchlängd</span><b>{fmtTime(p.durationS)}</b></div>
              <div className="muted">Survival har ingen rutt. Du rör dig fritt längs stigarna. Extraction öppnar vid 80 % av tiden.</div>
            </>
          )}
          {view.movedFromPreview && <div className="card warn">Du har rört dig från startpunkten. Uppdatera förslaget.</div>}
          {view.messages.map((m) => <div key={m} className="card warn">{m}</div>)}
          <div className="muted">Rutten är en vägledning, inte ett krav. Korsa aldrig väg eller järnväg bara för att spelet föreslår det.</div>
          <div className="row">
            <button className="btn" disabled={busy || stage === "preparing"} onClick={() => run(() => session!.regenerate())}>{p.mode === "survival" ? "UPPDATERA" : "NYTT FÖRSLAG"}</button>
            <button className="btn" disabled={busy} onClick={() => session!.backToConfig()}>ÄNDRA</button>
          </div>
          <button
            className="btn primary big"
            disabled={!ok || stage === "preparing" || view.movedFromPreview || !session!.currentStart()}
            onClick={() => run(async () => { unlockAudio(); if (await session!.startMatch()) router.push("/play"); })}
          >
            START
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="page">
      <PageHeader title="NEW GAME" />
      <div className={`card ${gps.tone}`} role="status">{gps.text}</div>
      <Seg<GameMode> label="Spelläge" value={p.mode} options={(["mission", "escape", "survival"] as GameMode[]).map((m) => ({ v: m, t: MODE_LABEL[m] }))} onChange={(mode) => set({ mode })} />
      <div className="muted">{MODE_HELP[p.mode]}</div>
      <Seg<Activity> label="Aktivitet" value={p.activity} options={(["walk", "run", "mtb"] as Activity[]).map((a) => ({ v: a, t: ACTIVITY_LABEL[a] }))} onChange={(a) => setP(withActivity(p, a))} />
      <Seg<Difficulty> label="Svårighet" value={p.difficulty} options={(["easy", "normal", "hard"] as Difficulty[]).map((d) => ({ v: d, t: DIFFICULTY_LABEL[d] }))} onChange={(difficulty) => set({ difficulty })} />
      {p.mode === "survival" ? (
        <div className="field">
          <label htmlFor="dur">Matchlängd: <b>{Math.round(p.durationS / 60)} min</b></label>
          <input id="dur" type="range" min={dur.minMin} max={dur.maxMin} step={dur.stepMin} value={Math.round(p.durationS / 60)} onChange={(e) => set({ durationS: Number(e.target.value) * 60 })} />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="dist">{p.mode === "escape" ? "Sträcka A→B" : "Sträcka (slinga)"}: <b>{fmtKm(p.targetLengthM)}</b></label>
          <input id="dist" type="range" min={limit.min} max={limit.max} step={limit.step} value={p.targetLengthM} onChange={(e) => set({ targetLengthM: Number(e.target.value) })} />
          <span className="muted">Tidsgränsen beräknas från rutten i lugn fart. Ingen bonus för att vara snabb.</span>
        </div>
      )}
      <label className="muted" style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}>
        <input type="checkbox" checked={cues} onChange={(e) => { setCues(e.target.checked); setCuesEnabled(e.target.checked); }} style={{ width: 22, height: 22 }} />
        Ljud och vibration vid händelser (vibration saknas på iPhone)
      </label>
      <button className="btn primary big" disabled={!canPrepare} onClick={() => run(async () => { unlockAudio(); await session!.prepare(clampParams({ ...p, seed: Math.floor(Math.random() * 1e9) })); })}>
        {p.mode === "survival" ? "VISA OMRÅDE" : "VISA RUTT"}
      </button>
      {!ctx && <div className="muted">Laddar…</div>}
    </main>
  );
}
