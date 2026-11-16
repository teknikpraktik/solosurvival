import { HomeMore, HomePlay } from "./_client/HomeMenu";

/*
 * The start page is a title screen: the logo and the name over the picture, two equal ways to play (CAMPAIGN and FREE PLAY), and one
 * small menu button at the bottom for everything else. The picture carries the mood; nothing else is on the screen until it is asked for.
 */
export default function Home() {
  return (
    <main className="center hero home">
      <div className="homecol">
        <header className="homehead">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="herologo" src="/img/logo-rings.png" alt="" width={112} height={112} />
          <h1 className="title">OUTBREAK</h1>
          <p className="sub">SOLO SURVIVAL</p>
        </header>
        <HomePlay />
        <HomeMore />
      </div>
    </main>
  );
}
