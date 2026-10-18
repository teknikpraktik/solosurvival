"use client";

import Link from "next/link";
import { PageHeader } from "../_client/Modal";
import { useCallback, useEffect, useState } from "react";
import { MatchStorage, type HistoryRecord } from "@/play/storage";
import { ACTIVITY_LABEL, DIFFICULTY_LABEL, MODE_LABEL, RESULT_LABEL, fmtDate, fmtKm, fmtTime } from "../_client/format";
import { useSessionCtx } from "../_client/SessionProvider";

export default function History() {
  const ctx = useSessionCtx();
  const [items, setItems] = useState<HistoryRecord[] | null>(null);
  const st = ctx?.db ? new MatchStorage(ctx.db) : null;

  const load = useCallback(async () => { setItems(st ? await st.listHistory() : []); }, [ctx?.db]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ctx) void load(); }, [ctx, load]);

  return (
    <main className="page">
      <PageHeader title="PREVIOUS GAMES" />
      {items === null && <div className="muted">Laddar…</div>}
      {items?.length === 0 && <div className="card">Inga matcher än. {ctx && !ctx.db && "Lokal lagring är inte tillgänglig i den här webbläsaren (t.ex. privat läge), så matcher sparas inte."}</div>}
      <div className="hist">
        {items?.map((h) => (
          <div className="card" key={h.id}>
            <div><b>{MODE_LABEL[h.mode]}</b> · {ACTIVITY_LABEL[h.activity]} · {DIFFICULTY_LABEL[h.difficulty]}</div>
            <div className={`res ${h.result}`}>{RESULT_LABEL[h.result] ?? h.result}</div>
            <div className="muted">{fmtDate(h.startedAt)}</div>
            <div className="muted" style={{ textAlign: "right" }}>{fmtTime(h.elapsedS)} · {fmtKm(h.measuredDistanceM)}</div>
            <div className="muted">{h.plannedLengthM ? `Rutt ${fmtKm(h.plannedLengthM)}` : "Ingen rutt"}{h.checkpoints ? ` · mål ${h.checkpoints.reached}/${h.checkpoints.total}` : ""}</div>
            <div style={{ textAlign: "right" }}>
              <button className="link" onClick={async () => { if (st && confirm("Radera den här matchen från enheten?")) { await st.deleteMatch(h.id); await load(); } }}>Radera</button>
            </div>
          </div>
        ))}
      </div>
      {items && items.length > 0 && (
        <button className="link" onClick={async () => { if (st && confirm("Radera ALLA matcher och testdata från enheten?")) { await st.deleteAll(); await load(); } }}>Radera allt</button>
      )}
    </main>
  );
}
