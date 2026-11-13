import Link from "next/link";
import { SoundSettings } from "./_client/SoundSettings";

export default function Home() {
  return (
    <main className="center hero">
      <h1 className="title">OUTBREAK</h1>
      <p className="sub">SOLO SURVIVAL</p>
      <Link className="btn primary" href="/new">NEW GAME</Link>
      <Link className="btn" href="/history">PREVIOUS GAMES</Link>
      <Link className="btn" href="/how-to-play">HOW TO PLAY</Link>
      <SoundSettings />
      <p className="hint">
        <Link href="/field">Test mode</Link> · <Link href="/dev">Simulator</Link>
      </p>
    </main>
  );
}
