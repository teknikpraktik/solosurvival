import Link from "next/link";
import { CampaignTeaser } from "./_client/CampaignTeaser";
import { t } from "./_client/strings";

/* Campaigns are the main attraction: a wide picture card. Free Play (the three standalone modes) is one quiet step below it, the rest lower still. */
export default function Home() {
  const S = t().home;
  return (
    <main className="center hero home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="herologo" src="/img/logo-rings.png" alt="" width={112} height={112} />
      <h1 className="title">OUTBREAK</h1>
      <p className="sub">SOLO SURVIVAL</p>
      <CampaignTeaser />
      <nav className="homesec" aria-label="More">
        <Link className="btn freeplay" href="/new">{S.freePlay}</Link>
        <Link className="btn" href="/history">PREVIOUS GAMES</Link>
        <Link className="btn" href="/how-to-play">HOW TO PLAY</Link>
        <Link className="btn" href="/settings">SETTINGS</Link>
      </nav>
    </main>
  );
}
