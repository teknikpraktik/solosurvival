import Link from "next/link";
import { CampaignTeaser } from "./_client/CampaignTeaser";
import { t } from "./_client/strings";
import { BOOK_SVG, GEAR_SVG, HISTORY_SVG } from "./_client/symbols";

/*
 * The start page: two ways to play as picture cards (the campaign large, Free Play compact), and the rest as one row of three at the
 * bottom. Nothing is fixed to the screen: on a short phone the page scrolls, and the row stays reachable below the cards.
 */
export default function Home() {
  const S = t().home;
  const more: [string, string, string][] = [["/history", S.previous, HISTORY_SVG], ["/how-to-play", S.howTo, BOOK_SVG], ["/settings", S.settings, GEAR_SVG]];
  return (
    <main className="center hero home">
      <div className="homecol">
        <header className="homehead">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="herologo" src="/img/logo-rings.png" alt="" width={112} height={112} />
          <h1 className="title">OUTBREAK</h1>
          <p className="sub">SOLO SURVIVAL</p>
        </header>
        <CampaignTeaser />
        <Link className="freecard freeplay" href="/new" aria-label={`${S.freePlay}. ${S.freePlaySub}`}>
          <span className="freecard-bg" aria-hidden="true" />
          <span className="freecard-text" aria-hidden="true">
            <b>{S.freePlay}</b>
            <span>{S.freePlaySub}</span>
          </span>
          <span className="freecard-go" aria-hidden="true">→</span>
        </Link>
        <nav className="homenav" aria-label={S.more}>
          {more.map(([href, label, icon]) => (
            <Link key={href} href={href}>
              <span className="homenav-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }} />
              <span className="homenav-label">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
