"use client";

import Link from "next/link";
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
  const [battery, setBattery] = useState<string>("Battery API saknas i den här webbläsaren (iPhone): läs av procent manuellt före och efter.");
  const [storage, setStorage] = useState("");
  const [secure, setSecure] = useState(true);
  const [wakeLock, setWakeLock] = useState<boolean | null>(null);

  const load = useCallback(async () => { setLogs(ctx?.db ? await ctx.db.store<FieldLogData>("logs").all() : []); }, [ctx?.db]);
  useEffect(() => { setTrace(traceEnabled()); setSecure(window.isSecureContext); setWakeLock("wakeLock" in navigator); void load(); }, [load]);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
    nav.getBattery?.().then((b) => setBattery(`Batteri ${Math.round(b.level * 100)} %${b.charging ? " (laddar)" : ""} – notera före/efter passet.`)).catch(() => undefined);
    navigator.storage?.estimate?.().then((e) => setStorage(`${((e.usage ?? 0) / 1e6).toFixed(1)} MB av ${((e.quota ?? 0) / 1e6).toFixed(0)} MB`)).catch(() => undefined);
  }, []);

  return (
    <main className="page">
      <PageHeader title="TESTLÄGE" />
      <div className="card">Loggar, matcher och GPS-spår är lokala: ingen telemetri skickas och inget laddas upp. Export sker bara när du trycker på knappen. Enda externa anropet är kartrutor från OpenFreeMap (se HOW TO PLAY).</div>

      <h2>GPS-test (utan match)</h2>
      <div className="card">
        <button className="btn" onClick={() => ctx?.session.startLocating()}>Starta GPS</button>
        <div className="stat"><span>Status</span><b>{view?.gpsError ? errorText[view.gpsError.code] : view?.accuracyM == null ? "ingen fix" : `±${Math.round(view.accuracyM)} m`}</b></div>
        <div className="stat"><span>Kvalitet</span><b>{view?.quality ?? "–"}</b></div>
        <div className="stat"><span>Position</span><b>{view?.position ? `${view.position.lat.toFixed(5)}, ${view.position.lon.toFixed(5)}` : "–"}</b></div>
        <div className="stat"><span>Säker kontext (HTTPS)</span><b>{secure ? "ja" : "NEJ – GPS fungerar inte"}</b></div>
        <div className="stat"><span>Wake Lock</span><b>{wakeLock === null ? "–" : wakeLock ? "stöds" : "stöds ej"}</b></div>
        <div className="stat"><span>Lagring</span><b>{storage || "–"}</b></div>
        <div className="stat"><span>Version</span><b>{BUILD_ID}</b></div>
        <div className="muted">{battery}</div>
      </div>

      <h2>Loggning</h2>
      <label className="muted" style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}>
        <input type="checkbox" checked={trace} style={{ width: 22, height: 22 }} onChange={(e) => { setTrace(e.target.checked); setTraceEnabled(e.target.checked); }} />
        Spara GPS-spår lokalt i testloggen (1 punkt/s, gäller nya matcher). Av som standard.
      </label>
      {logs.length === 0 && <div className="card">Inga testloggar sparade.</div>}
      {logs.map((l) => {
        const s = l.summary as { mode?: string; activity?: string; result?: string; measuredDistanceM?: number; matchTimeS?: number; gps?: { fixes: number; dropouts: number; meanAccuracyM: number | null } } | undefined;
        return (
          <div className="card" key={l.matchId}>
            <div><b>{s?.mode ?? "?"}</b> · {s?.activity} · {s?.result ?? "pågår"} · {l.startedAtIso.slice(0, 16).replace("T", " ")}</div>
            <div className="muted">{s?.gps ? `${s.gps.fixes} fixar, medel ±${s.gps.meanAccuracyM ?? "–"} m, ${s.gps.dropouts} bortfall` : ""} · {l.entries.length} händelser{l.trace ? ` · spår ${l.trace.length} pkt` : ""}</div>
            <div className="row">
              <button className="btn" onClick={() => download(`outbreak-${l.matchId}.json`, JSON.stringify(l, null, 1))}>Exportera</button>
              <button className="btn" onClick={async () => { if (ctx?.db && confirm("Radera loggen?")) { await ctx.db.store("logs").delete(l.matchId); await load(); } }}>Radera</button>
            </div>
          </div>
        );
      })}
      <div className="row">
        <button className="btn" disabled={!logs.length || !ctx?.db} onClick={async () => download("outbreak-testloggar.json", await exportAllLogs(ctx!.db!))}>Exportera alla</button>
        <button className="btn" disabled={!ctx?.db} onClick={async () => { if (ctx?.db && confirm("Radera ALLA matcher, loggar och sparad kartdata från enheten?")) { await new MatchStorage(ctx.db).deleteAll(); await ctx.db.store("tiles").clear(); await load(); } }}>Radera allt</button>
      </div>
      <p className="muted">Fältprotokoll: se docs/ETAPP-3.md. Notera alltid enhet, OS, webbläsare (eller installerad PWA), väder, skogstäthet och om skärmen var låst.</p>
    </main>
  );
}
