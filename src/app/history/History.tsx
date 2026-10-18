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
      {items === null && <div className="muted">Loading…</div>}
      {items?.length === 0 && <div className="card">No matches yet. {ctx && !ctx.db && "Local storage is not available in this browser (for example private mode), so matches are not saved."}</div>}
      <div className="hist">
        {items?.map((h) => (
          <div className="card" key={h.id}>
            <div><b>{MODE_LABEL[h.mode]}</b> · {ACTIVITY_LABEL[h.activity]} · {DIFFICULTY_LABEL[h.difficulty]}</div>
            <div className={`res ${h.result}`}>{RESULT_LABEL[h.result] ?? h.result}</div>
            <div className="muted">{fmtDate(h.startedAt)}</div>
            <div className="muted" style={{ textAlign: "right" }}>{fmtTime(h.elapsedS)} · {fmtKm(h.measuredDistanceM)}</div>
            <div className="muted">{h.plannedLengthM ? `Route ${fmtKm(h.plannedLengthM)}` : "No route"}{h.checkpoints ? ` · goals ${h.checkpoints.reached}/${h.checkpoints.total}` : ""}</div>
            <div style={{ textAlign: "right" }}>
              <button className="link" onClick={async () => { if (st && confirm("Delete this match from the device?")) { await st.deleteMatch(h.id); await load(); } }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {items && items.length > 0 && (
        <button className="link" onClick={async () => { if (st && confirm("Delete ALL matches and test data from the device?")) { await st.deleteAll(); await load(); } }}>Delete all</button>
      )}
    </main>
  );
}
