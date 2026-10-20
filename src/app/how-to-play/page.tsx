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
      <p>The arrow is you and points the way you are moving. The map rotates so your direction of travel is up (Track Up); the compass button switches to north up. Standing still, the arrow keeps its last direction. Zombies show as faces when they are within 1 km, with the distance written beside the three closest. A short sound warns you when a new zombie comes close. The speaker button turns sound off.</p>

      <h2>Game modes</h2>
      <ul>
        <li><b>MISSION</b> – a loop from your start with a checkpoint about every 500 m on foot or every 1 km by bike. Reach them in order, then return to the start.</li>
        <li><b>A TO B</b> – you pick A (your start, your position by default) and B (the goal) on the map. Any route you like counts; a faint line shows the straight line between A and B. You must stand at A to start.</li>
        <li><b>SURVIVAL</b> – no route. Survive until extraction opens (at 80 % of the time), then reach it.</li>
      </ul>
      <p>The route shown is a suggestion. You may go anywhere you like – but zombies follow only the trails, and a goal counts only after you stand within 30 m for 5 seconds.</p>

      <h2>Activity and difficulty</h2>
      <p>On foot and Bike use different trail networks, speeds and time limits. Difficulty changes how many zombies there are, how fast they are, and how generous the time limit is. There is no bonus for being fast.</p>

      <h2>Zombies</h2>
      <p>Zombies hunt you from the first second, always heading for you along the trails. When a zombie gets within 100 m it can sprint at 1.5× its speed for 30 seconds, then it must recover. Shake them off by taking another path, or keep moving.</p>

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

      <h2>Credits</h2>
      <p>Photographs used in the app, all cropped, darkened and colour-graded:</p>
      <ul>
        <li>Start page: “Crazy zombie boy in the studio” by Heath Cajandig, <a href="https://commons.wikimedia.org/wiki/File:Crazy_zombie_boy_in_the_studio.jpg">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>.</li>
        <li>Captured screen: “The Walking Dead Cosplay” by Ian Livesey, <a href="https://commons.wikimedia.org/wiki/File:The_Walking_Dead_Cosplay.jpg">Wikimedia Commons</a> (public domain).</li>
        <li>Other images: “Zombie Halloween Mask” by Sharpshotefx, <a href="https://commons.wikimedia.org/wiki/File:Zombie_Halloween_Mask.jpg">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</li>
      </ul>
      <p>The route shown is a suggestion. You may go anywhere you like – but zombies follow only the trails, and a goal counts only after you stand within 30 m for 5 seconds.</p>

      <h2>Activity and difficulty</h2>
      <p>On foot and Bike use different trail networks, speeds and time limits. Difficulty changes how many zombies there are, how fast they are, and how generous the time limit is. There is no bonus for being fast.</p>

      <h2>Zombies</h2>
      <p>Zombies hunt you from the first second, always heading for you along the trails. When a zombie gets within 100 m it can sprint at 1.5× its speed for 30 seconds, then it must recover. Shake them off by taking another path, or keep moving.</p>

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

      <h2>Credits</h2>
      <p>Photographs used in the app, all cropped, darkened and colour-graded:</p>
      <ul>
        <li>Start page: “Crazy zombie boy in the studio” by Heath Cajandig, <a href="https://commons.wikimedia.org/wiki/File:Crazy_zombie_boy_in_the_studio.jpg">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>.</li>
        <li>Captured screen: “Zombie Halloween Mask” by Sharpshotefx, <a href="https://commons.wikimedia.org/wiki/File:Zombie_Halloween_Mask.jpg">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</li>
        <li>Other images: <a href="https://commons.wikimedia.org/wiki/File:As_a_film_Make-up_artist,_Creating_Zombies_is_something_I_enjoy_doing_at_SCARLET_STUDIOS.jpg">a zombie make-up photo on Wikimedia Commons</a> (CC0 / public domain).</li>
      </ul>

      <h2>Your data</h2>
      <p>Matches, location data and test logs are stored only on your device. No login, no upload. You can delete matches under PREVIOUS GAMES.</p>
      <p>The background map (forest, water, roads) is loaded as map tiles from OpenFreeMap (data © OpenStreetMap contributors, © OpenMapTiles). That provider sees your IP address and which map area is shown, but not your location as such or your matches. Without a connection the game works with just the trail network.</p>
    </main>
  );
}
