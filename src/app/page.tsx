import Link from "next/link";
import ResumeBanner from "./_client/ResumeBanner";

export default function Home() {
  return (
    <main className="center hero">
      <h1 className="title">OUTBREAK</h1>
      <p className="sub">SOLO SURVIVAL</p>
      <ResumeBanner />
      <Link className="btn primary" href="/new">NEW GAME</Link>
      <Link className="btn" href="/history">PREVIOUS GAMES</Link>
      <Link className="btn" href="/how-to-play">HOW TO PLAY</Link>
      <p className="hint" style={{ maxWidth: 320 }}>
        The game is only a guide. Follow traffic rules and landowners&apos; instructions, never cross a road or railway just because the game suggests it, and never look at the screen while cycling.
      </p>
      <p className="hint">
        <Link href="/field">Test mode</Link> · <Link href="/dev">Simulator</Link>
      </p>
    </main>
  );
}
