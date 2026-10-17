import Link from "next/link";
import ResumeBanner from "./_client/ResumeBanner";

export default function Home() {
  return (
    <main className="center">
      <h1 className="title">OUTBREAK</h1>
      <p className="sub">SOLO SURVIVAL</p>
      <ResumeBanner />
      <Link className="btn primary" href="/new">NEW GAME</Link>
      <Link className="btn" href="/history">PREVIOUS GAMES</Link>
      <Link className="btn" href="/how-to-play">HOW TO PLAY</Link>
      <p className="hint" style={{ maxWidth: 320 }}>
        Spelet är vägledande. Följ trafikregler och markägares anvisningar, korsa aldrig väg eller järnväg på rutten, och titta inte på skärmen när du cyklar.
      </p>
      <p className="hint">
        <Link href="/field">Testläge</Link> · <Link href="/dev">Simulator</Link>
      </p>
    </main>
  );
}
