import Link from "next/link";

/* NEW GAME is the one main action: large and red. The rest are secondary, stacked so their labels never wrap, but lower and quieter. */
export default function Home() {
  return (
    <main className="center hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="herologo" src="/img/logo-rings.png" alt="" width={112} height={112} />
      <h1 className="title">OUTBREAK</h1>
      <p className="sub">SOLO SURVIVAL</p>
      <Link className="btn primary big homemain" href="/new">NEW GAME</Link>
      <nav className="homesec" aria-label="More">
        <Link className="btn" href="/history">PREVIOUS GAMES</Link>
        <Link className="btn" href="/how-to-play">HOW TO PLAY</Link>
        <Link className="btn" href="/settings">SETTINGS</Link>
      </nav>
    </main>
  );
}
