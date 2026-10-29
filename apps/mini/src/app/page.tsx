import Link from "next/link";
import ResumeBanner from "../client/ResumeBanner";
import { Critters } from "../client/Critters";

export default function Home() {
  return (
    <main className="center hero">
      <Critters size={72} className="critters parade" />
      <h1 className="title">MINI OUTBREAK</h1>
      <p className="sub">SOLO SURVIVAL</p>
      <ResumeBanner />
      <Link className="btn primary" href="/new">NEW GAME</Link>
      <Link className="btn" href="/history">MY GAMES</Link>
      <Link className="btn" href="/how-to-play">HOW TO PLAY</Link>
      <p className="hint" style={{ maxWidth: 320 }}>
        Play with a grown-up nearby, in a place they have said is OK. Watch out for traffic and never run out onto a road.
      </p>
    </main>
  );
}
