import Link from "next/link";
import { SoundSettings } from "./_client/SoundSettings";

export default function Home() {
  return (
    <main className="center hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="herologo" src="/img/logo-rings.png" alt="" width={112} height={112} />
      <h1 className="title">OUTBREAK</h1>
      <p className="sub">SOLO SURVIVAL</p>
      <Link className="btn primary" href="/new">NEW GAME</Link>
      <Link className="btn" href="/history">PREVIOUS GAMES</Link>
      <Link className="btn" href="/how-to-play">HOW TO PLAY</Link>
      <SoundSettings />
      <p className="hint">
        <Link href="/field">Test mode</Link>
      </p>
    </main>
  );
}
