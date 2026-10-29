import { PageHeader } from "../_client/Modal";

export const metadata = { title: "How to play – OUTBREAK" };

export default function HowToPlay() {
  return (
    <main className="page">
      <PageHeader title="HOW TO PLAY" />

      <div className="card warn">
        <b>Safety first.</b> The game is only a guide. You decide how you move. Follow traffic rules, do not cross a road or railway just because the game suggests it, and do not enter private land, dangerous terrain or water. Never look at the screen while cycling: rely on sound and vibration, or stop. You can quit at any time, and stopping for safety costs you nothing.
      </div>

      <h2>The idea</h2>
      <p>Zombies move only along real trails and roads. You move in the real world with your phone in your pocket or on your handlebars. The game follows your location.</p>

      <h2>The map</h2>
      <ul>
        <li>The arrow is you and points the way you are moving. Standing still, it keeps its last direction.</li>
        <li>All zombies show as faces, however far away, with the distance written beside the three closest.</li>
        <li>The checkpoint to head for is blue and turns green once you have taken it. When your next goal is off screen, a small blue arrow at the edge of the map points to it.</li>
        <li>The scale bar at the bottom shows distances on the map.</li>
      </ul>

      <h2>Sound and voice</h2>
      <ul>
        <li>A short sound warns you when a new zombie comes close.</li>
        <li>When a zombie is within 100 m its distance is shown larger and spoken: 100, 50, 40, 30, 20, 10.</li>
        <li>A taken checkpoint gives a bright chime and a spoken &quot;Checkpoint&quot;.</li>
      </ul>

      <h2>Buttons</h2>
      <ul>
        <li><b>AUTO</b> (green) – the map follows you, turns so your direction of travel is up, and zooms by itself: about 1 km ahead on a bike (400 m on foot), closer when a zombie or your next checkpoint is near, wide again once the checkpoint is taken. Every match starts in AUTO.</li>
        <li>Touch the map to move or zoom it yourself: AUTO turns off (grey) and the map stays where you put it. Tap AUTO to follow again.</li>
        <li><b>Speaker</b> turns sound off and on.</li>
      </ul>

      <h2>Game modes</h2>
      <ul>
        <li><b>CHECKPOINTS</b> – numbered checkpoints about every 500 m on foot or every 1 km by bike, as the crow flies. No route is shown: fetch them in order, choose your own way, then return home. The distance you choose is the sum of the straight lines between the checkpoints.</li>
        <li><b>A TO B</b> – A is where you are now and you pick B (the goal) on the map. Any route you like counts; a faint line shows the straight line between A and B. You must stand at A to start.</li>
        <li><b>SURVIVAL</b> – no route. Survive until extraction opens near the end (shown before you start, e.g. after 20 min in a 30-minute match), then reach it.</li>
      </ul>
      <p>You may go anywhere you like – but zombies follow only the trails, and a goal counts only after you stand within 30 m for 5 seconds.</p>

      <h2>Activity and difficulty</h2>
      <p>On foot and Bike use different trail networks, speeds and time limits. Difficulty changes how many zombies there are, how fast they are, and how generous the time limit is. The difficulty is shown next to the mode at the top of the screen. There is no bonus for being fast.</p>

      <h2>Zombies</h2>
      <p>Zombies hunt you from the first second, always heading for you along the trails. When a zombie gets within 100 m it can sprint: it speeds up (up to 1.25× its speed on Easy, 1.4× on Normal, 1.5× on Hard), then slowly loses that speed again and has to rest before it can sprint again. Shake them off by taking another path, or keep moving.</p>

      <h2>Capture</h2>
      <p>If a zombie stays within 20 m for a few seconds you are captured and the match is over. With uncertain location accuracy this takes longer or is paused. The game never captures you from an old or guessed position.</p>

      <h2>Location and screen</h2>
      <ul>
        <li>The app must stay open and in the foreground. Browsers cannot guarantee location in the background – if you lock the screen or switch app, the game pauses and you continue manually.</li>
        <li>If the location signal drops, the clock and the zombies stand still until it is back.</li>
        <li>The game tries to keep the screen on. That uses more battery; bring a power bank on long sessions.</li>
        <li>Open sky gives the best accuracy. Dense forest and cliffs can make it less accurate.</li>
      </ul>

      <h2>Map data</h2>
      <p>Trails and roads come from OpenStreetMap (© OpenStreetMap contributors, ODbL). Map data can be incomplete or wrong. The game excludes trails marked private or forbidden and tries to avoid roads, railways and water – but a stretch appearing in the game does not mean it is safe or allowed.</p>
      <p>The background map (forest, water, roads) is loaded as map tiles from OpenFreeMap (data © OpenStreetMap contributors, © OpenMapTiles). That provider sees your IP address and which map area is shown, but not your location as such or your matches. Without a connection the game works with just the trail network.</p>

      <h2>Your data</h2>
      <p>Matches, location data and test logs are stored only on your device. No login, no upload. You can delete matches under PREVIOUS GAMES.</p>

      <h2>Credits</h2>
      <p>Photographs used in the app, all cropped, darkened and colour-graded:</p>
      <ul>
        <li>Start page: “Crazy zombie boy in the studio” by Heath Cajandig, <a href="https://commons.wikimedia.org/wiki/File:Crazy_zombie_boy_in_the_studio.jpg">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>.</li>
        <li>Captured screen: “The Walking Dead Cosplay” by Ian Livesey, <a href="https://commons.wikimedia.org/wiki/File:The_Walking_Dead_Cosplay.jpg">Wikimedia Commons</a> (public domain).</li>
        <li>Settings-page backdrop: “Zombie gals” by istolethetv, <a href="https://commons.wikimedia.org/wiki/File:Zombie_gals_(3261797845).jpg">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>.</li>
        <li>Jump scare: “Zombie Halloween Mask” by Sharpshotefx, <a href="https://commons.wikimedia.org/wiki/File:Zombie_Halloween_Mask.jpg">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</li>
      </ul>
    </main>
  );
}
