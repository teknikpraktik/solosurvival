"use client";

import { PageHeader } from "@/app/_client/Modal";
import { useCallback, useEffect, useState } from "react";
import { MatchStorage, type HistoryRecord } from "@/play/storage";
import { fmtDate, fmtKm, fmtTime } from "@/app/_client/format";
import { DIFFICULTY_LABEL, MODE_LABEL, RESULT_LABEL } from "../../client/text";
import { useSessionCtx } from "../../client/SessionProvider";

export default function History() {
  const ctx = useSessionCtx();
  const [items, setItems] = useState<HistoryRecord[] | null>(null);
  const st = ctx?.db ? new MatchStorage(ctx.db) : null;

  const load = useCallback(async () => { setItems(st ? await st.listHistory() : []); }, [ctx?.db]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ctx) void load(); }, [ctx, load]);

  return (
    <main className="page">
      <PageHeader title="MY GAMES" />
      {items === null && <div className="muted">Loading…</div>}
      {items?.length === 0 && <div className="card">No games yet. {ctx && !ctx.db && "Local storage is not available in this browser (for example private mode), so games are not saved."}</div>}
      <div className="hist">
        {items?.map((h) => (
          <div className="card" key={h.id}>
            <div><b>{MODE_LABEL[h.mode]}</b> · {DIFFICULTY_LABEL[h.difficulty]}</div>
            <div className={`res ${h.result}`}>{RESULT_LABEL[h.result] ?? h.result}</div>
            <div className="muted">{fmtDate(h.startedAt)}</div>
            <div className="muted" style={{ textAlign: "right" }}>{fmtTime(h.elapsedS)} · {fmtKm(h.measuredDistanceM)}</div>
            <div className="muted">{h.plannedLengthM ? `Route ${fmtKm(h.plannedLengthM)}` : "No route"}{h.checkpoints ? (h.mode === "escape" ? ` · B ${h.checkpoints.reached >= h.checkpoints.total ? "reached" : "not reached"}` : ` · checkpoints ${h.checkpoints.reached}/${h.checkpoints.total}`) : ""}</div>
            <div style={{ textAlign: "right" }}>
              <button className="link" onClick={async () => { if (st && confirm("Delete this game from the phone?")) { await st.deleteMatch(h.id); await load(); } }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {items && items.length > 0 && (
        <button className="link" onClick={async () => { if (st && confirm("Delete ALL games from the phone?")) { await st.deleteAll(); await load(); } }}>Delete all</button>
      )}
    </main>
  );
}
