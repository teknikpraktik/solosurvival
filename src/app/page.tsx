import Link from "next/link";

export default function Home() {
  return (
    <main className="center">
      <h1 className="title">OUTBREAK</h1>
      <p className="sub">SOLO SURVIVAL</p>
      <Link className="btn primary" href="/dev">DEV: SIMULERAD MATCH</Link>
      <span className="btn" aria-disabled="true">NEW GAME</span>
      <span className="btn" aria-disabled="true">PREVIOUS GAMES</span>
      <span className="btn" aria-disabled="true">HOW TO PLAY</span>
      <p className="hint">Etapp 0–2: spelmotorn är körbar och simulerbar. Spelflödet byggs i etapp 3–4.</p>
    </main>
  );
}
