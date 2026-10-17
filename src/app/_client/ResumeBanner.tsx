"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSessionCtx, useSessionView } from "./SessionProvider";

/** Visar en genväg om en pågående match finns sparad. */
export default function ResumeBanner() {
  const ctx = useSessionCtx();
  const view = useSessionView(ctx?.session);
  const [active, setActive] = useState(false);
  useEffect(() => { void ctx?.session.hasActive().then(setActive).catch(() => setActive(false)); }, [ctx]);
  const live = view?.stage === "playing";
  if (!ctx || (!active && !live)) return null;
  return (
    <div className="card good" style={{ width: "min(320px,100%)" }}>
      <div style={{ marginBottom: 8 }}>Pågående match hittades.</div>
      <Link className="btn primary" href="/play" style={{ width: "100%" }}>FORTSÄTT MATCH</Link>
    </div>
  );
}
