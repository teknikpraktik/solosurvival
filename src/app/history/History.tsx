"use client";

import { Modal, PageHeader } from "../_client/Modal";
import { Loader } from "../_client/Loader";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MatchStorage, type HistoryRecord } from "@/play/storage";
import { RecapStore } from "@/play/recap";
import { ACTIVITY_LABEL, DIFFICULTY_LABEL, MODE_LABEL, RESULT_LABEL, fmtDate, fmtKm, fmtTime } from "../_client/format";
import { useSessionCtx } from "../_client/SessionProvider";

export default function History() {
  const ctx = useSessionCtx();
  const [items, setItems] = useState<HistoryRecord[] | null>(null);
  const [maps, setMaps] = useState<Set<string>>(new Set());
  /** What the player is asked to confirm deleting: one match (its id) or all of them (null). */
  const [ask, setAsk] = useState<{ id: string | null } | null>(null);
  const st = ctx?.db ? new MatchStorage(ctx.db) : null;

  const load = useCallback(async () => {
    setItems(st ? await st.listHistory() : []);
    if (ctx?.db) { const r = new RecapStore(ctx.db); await r.purge(Date.now()); setMaps(await r.ids()); }
  }, [ctx?.db]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ctx) void load(); }, [ctx, load]);

  return (
    <main className="page">
      <PageHeader title="PREVIOUS GAMES" />
      {items === null && <Loader />}
      {items?.length === 0 && <div className="card">No matches yet. {ctx && !ctx.db && "Local storage is not available in this browser (for example private mode), so matches are not saved."}</div>}
      <div className="hist">
        {items?.map((h) => (
          <div className="card" key={h.id}>
            <div><b>{MODE_LABEL[h.mode]}</b> · {ACTIVITY_LABEL[h.activity]} · {DIFFICULTY_LABEL[h.difficulty]}</div>
            <div className={`res ${h.result}`}>{RESULT_LABEL[h.result] ?? h.result}</div>
            <div className="muted">{fmtDate(h.startedAt)}</div>
            <div className="muted" style={{ textAlign: "right" }}>{fmtTime(h.elapsedS)} · {fmtKm(h.measuredDistanceM)}</div>
            <div className="muted">{h.plannedLengthM ? `Route ${fmtKm(h.plannedLengthM)}` : "No route"}{h.checkpoints ? (h.mode === "escape" ? ` · B ${h.checkpoints.reached >= h.checkpoints.total ? "reached" : "not reached"}` : ` · checkpoints ${h.checkpoints.reached}/${h.checkpoints.total}`) : ""}</div>
            <div>{maps.has(h.id) && <Link className="link" href={`/recap?id=${encodeURIComponent(h.id)}`}>Show match</Link>}</div>
            <div style={{ textAlign: "right" }}>
              <button className="link" onClick={() => setAsk({ id: h.id })}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {items && items.length > 0 && (
        <button className="link" onClick={() => setAsk({ id: null })}>Delete all</button>
      )}
      {/* The game's own dialog, never the browser's confirm box. */}
      {ask && (
        <Modal
          title={ask.id ? "Delete this match?" : "Delete all matches?"}
          onClose={() => setAsk(null)}
          actions={
            <>
              <button className="btn primary" onClick={async () => { const a = ask; setAsk(null); if (!st) return; if (a.id) await st.deleteMatch(a.id); else await st.deleteAll(); await load(); }}>DELETE</button>
              <button className="btn" onClick={() => setAsk(null)}>KEEP</button>
            </>
          }
        >
          <div className="muted">{ask.id ? "It is removed from this device and cannot be brought back." : "Every match and all test data are removed from this device and cannot be brought back."}</div>
        </Modal>
      )}
    </main>
  );
}
