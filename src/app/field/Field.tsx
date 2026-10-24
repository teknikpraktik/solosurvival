"use client";

import { PageHeader } from "../_client/Modal";
import { useCallback, useEffect, useState } from "react";
import { exportAllLogs, type FieldLogData } from "@/play/fieldlog";
import { MatchStorage } from "@/play/storage";
import { errorText } from "@/gps/provider/provider";
import { useSessionCtx, useSessionView, setTraceEnabled, traceEnabled } from "../_client/SessionProvider";
import { BUILD_ID } from "../_client/build";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Field() {
  const ctx = useSessionCtx();
  const view = useSessionView(ctx?.session);
  const [logs, setLogs] = useState<FieldLogData[]>([]);
  const [trace, setTrace] = useState(false);
  const [battery, setBattery] = useState<string>("No Battery API in this browser (iPhone): read the percentage manually before and after.");
  const [storage, setStorage] = useState("");
  const [secure, setSecure] = useState(true);
  const [wakeLock, setWakeLock] = useState<boolean | null>(null);

  const load = useCallback(async () => { setLogs(ctx?.db ? await ctx.db.store<FieldLogData>("logs").all() : []); }, [ctx?.db]);
  useEffect(() => { setTrace(traceEnabled()); setSecure(window.isSecureContext); setWakeLock("wakeLock" in navigator); void load(); }, [load]);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
    nav.getBattery?.().then((b) => setBattery(`Battery ${Math.round(b.level * 100)} %${b.charging ? " (charging)" : ""} – note it before/after the session.`)).catch(() => undefined);
    navigator.storage?.estimate?.().then((e) => setStorage(`${((e.usage ?? 0) / 1e6).toFixed(1)} MB av ${((e.quota ?? 0) / 1e6).toFixed(0)} MB`)).catch(() => undefined);
  }, []);

  return (
    <main className="page">
      <PageHeader title="TEST MODE" />
      <div className="card">Logs, matches and GPS traces are local: no telemetry is sent and nothing is uploaded. Export only happens when you press the button. The only external requests are map tiles from OpenFreeMap (see HOW TO PLAY).</div>

      <h2>GPS test (no match)</h2>
      <div className="card">
        <button className="btn" onClick={() => ctx?.session.startLocating()}>Start GPS</button>
        <div className="stat"><span>Status</span><b>{view?.gpsError ? errorText[view.gpsError.code] : view?.accuracyM == null ? "no fix" : `±${Math.round(view.accuracyM)} m`}</b></div>
        <div className="stat"><span>Quality</span><b>{view?.quality ?? "–"}</b></div>
        <div className="stat"><span>Position</span><b>{view?.position ? `${view.position.lat.toFixed(5)}, ${view.position.lon.toFixed(5)}` : "–"}</b></div>
        <div className="stat"><span>Secure context (HTTPS)</span><b>{secure ? "yes" : "NO – location will not work"}</b></div>
        <div className="stat"><span>Wake Lock</span><b>{wakeLock === null ? "–" : wakeLock ? "supported" : "not supported"}</b></div>
        <div className="stat"><span>Storage</span><b>{storage || "–"}</b></div>
        <div className="stat"><span>Version</span><b>{BUILD_ID}</b></div>
        <div className="muted">{battery}</div>
      </div>

      <h2>Logging</h2>
      <label className="muted" style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}>
        <input type="checkbox" checked={trace} style={{ width: 22, height: 22 }} onChange={(e) => { setTrace(e.target.checked); setTraceEnabled(e.target.checked); }} />
        Save GPS trace locally in the test log (1 point/s, applies to new matches). Off by default.
      </label>
      {logs.length === 0 && <div className="card">No test logs saved.</div>}
      {logs.map((l) => {
        const s = l.summary as { mode?: string; activity?: string; result?: string; measuredDistanceM?: number; matchTimeS?: number; gps?: { fixes: number; dropouts: number; meanAccuracyM: number | null } } | undefined;
        return (
          <div className="card" key={l.matchId}>
            <div><b>{s?.mode ?? "?"}</b> · {s?.activity} · {s?.result ?? "in progress"} · {l.startedAtIso.slice(0, 16).replace("T", " ")}</div>
            <div className="muted">{s?.gps ? `${s.gps.fixes} fixes, mean ±${s.gps.meanAccuracyM ?? "–"} m, ${s.gps.dropouts} dropouts` : ""} · {l.entries.length} events{l.trace ? ` · trace ${l.trace.length} pts` : ""}</div>
            <div className="row">
              <button className="btn" onClick={() => download(`outbreak-${l.matchId}.json`, JSON.stringify(l, null, 1))}>Export</button>
              <button className="btn" onClick={async () => { if (ctx?.db && confirm("Delete this log?")) { await ctx.db.store("logs").delete(l.matchId); await load(); } }}>Delete</button>
            </div>
          </div>
        );
      })}
      <div className="row">
        <button className="btn" disabled={!logs.length || !ctx?.db} onClick={async () => download("outbreak-test-logs.json", await exportAllLogs(ctx!.db!))}>Export all</button>
        <button className="btn" disabled={!ctx?.db} onClick={async () => { if (ctx?.db && confirm("Delete ALL matches, logs and cached map data from the device?")) { await new MatchStorage(ctx.db).deleteAll(); await ctx.db.store("tiles").clear(); await load(); } }}>Delete all</button>
      </div>
      <p className="muted">Field protocol: see docs/ETAPP-3.md. Always note device, OS, browser (or installed PWA), weather, forest density and whether the screen was locked.</p>
    </main>
  );
}
