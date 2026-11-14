import { PageHeader } from "../_client/Modal";

export const metadata = { title: "How to play – OUTBREAK" };

/*
 * Every number here is taken from the game's code (checked when this page was rewritten):
 * checkpoints 500 m / 1 km apart (routes/course.ts), course 1–6 km / 4–30 km and match length 15–60 / 20–90 min (play/config.ts),
 * goals and extraction 30 m for 5 s (objectives.ts, game-rules.ts), capture 20 m for 3 s or 5 s (game-rules.ts), extraction at about
 * 80 % rounded down to 5 min and zombies 50 % faster then (game-rules.ts, modes.ts), sprint within 100 m, Bike hunt range 2 km
 * (activities.ts), off-road budget 90 s (offnetwork.ts), 45 s away and 5 s protection after a
 * pause (live-game.ts, game-rules.ts), location lost 60 s (game-rules.ts), vibration when a zombie comes within 200 m (camera-view.ts),
 * spoken distance 50, 40, 30, 20, 10 m (countdown.ts VOICE_COUNTDOWN_M), "Zombies approaching!" at 200 m and the roar at 100 m
 * (sound-rules.ts SOUND_RULES.approach / near).
 * Not described because it is not active: riding through a zombie on the bike (BIKE_PASS_THROUGH_KMH exists, passThroughMps is unset).
 * Change the text when those change.
 */
export default function HowToPlay() {
  return (
    <main className="page howto">
      <PageHeader title="HOW TO PLAY" />

      <div className="card warn">
        <b>Safety first.</b> The game is only a guide. Follow traffic rules and stay off private land, railways, water and dangerous ground,
        whatever the map shows. Never look at the screen while cycling: listen, or stop. You can quit at any time.
      </div>

      <h2>Start a match</h2>
      <ol>
        <li>Tap <b>NEW GAME</b> and choose <b>ON FOOT</b> (paths and trails) or <b>BY BIKE</b> (roads and gravel tracks).</li>
        <li>Choose a game mode.</li>
        <li>On the map, pick <b>Easy</b>, <b>Normal</b> or <b>Hard</b> and the course distance or match length, then tap <b>START GAME</b>.
          The match begins as soon as your location is good enough.</li>
      </ol>

      <h2>Game modes</h2>
      <ul>
        <li><b>CHECKPOINTS</b> – numbered checkpoints, about 500 m apart on foot and 1 km by bike (straight line). No route is shown:
          take them in order, any way you like, then return home to where you started. The course is 1–6 km on foot, 4–30 km by bike.
          <b> REGENERATE</b> gives another course.</li>
        <li><b>A TO B</b> – A is where you stand. Tap the map to set B, then reach it. Any way counts; a faint line shows the straight line.</li>
        <li><b>SURVIVAL</b> – no goal at first. Choose the match length (15–60 min on foot, 20–90 min by bike). At about 80 % of the time
          (20 min in a 30-minute match) the helicopter lands: extraction opens on the map and every zombie runs 50 % faster. Reach it.</li>
      </ul>
      <p>A checkpoint, home, B or the helicopter counts when you stay within 30 m of it for 5 seconds.</p>

      <h2>Win or lose</h2>
      <ul>
        <li><b>Win:</b> Checkpoints – every checkpoint, then home. A TO B – reach B. Survival – reach extraction.</li>
        <li><b>Lose:</b> a zombie captures you, or the time runs out first.</li>
        <li>Checkpoints and A TO B get a time limit from the course length at a calm pace; it is shown before you start. There is no bonus for being fast.</li>
      </ul>

      <h2>Difficulty</h2>
      <p>Harder means more and faster zombies that notice you from farther away, sprint harder, more often try to cut you off, and a
        tighter time limit in Checkpoints and A TO B. Survival has faster zombies than the other modes.</p>

      <h2>Zombies and capture</h2>
      <ul>
        <li>Zombies move only along trails and roads, and more appear as the match goes on. They know where you are from the start
          (by bike: those within 2 km; farther ones roam).</li>
        <li>Within 100 m a zombie can sprint for a short while, then it has to rest.</li>
        <li>A zombie within 20 m for 3 seconds captures you (5 seconds when your location is uncertain). It must be able to reach you along
          the trails, not across a road, railway or building. The red bar at the top shows it filling.</li>
        <li>After a pause you are protected for 5 seconds.</li>
        <li>By bike, off the road network you have 90 seconds before zombies waiting at the nearest road can reach you. The top bar counts it down.</li>
      </ul>

      <h2>During the match</h2>
      <ul>
        <li><b>Top:</b> mode and difficulty, <b>TIME LEFT</b>, your next goal and its distance (Survival: a helicopter with the time until extraction),
          and 💀 the nearest zombie – amber within 200 m, red and larger within 100 m.</li>
        <li><b>Left:</b> the distance you have moved and the time played in this match; by bike also your speed.</li>
        <li><b>Map:</b> you are the blue marker. Zombies are faces; the three closest show their distance. When your goal is off screen,
          an arrow at the edge points to it.</li>
        <li><b>PAUSE</b> stops the clock and the zombies. <b>AUTO</b> lets the map follow you; touch the map to move it yourself.
          The <b>speaker</b> turns sound off and on. <b>QUIT</b> asks once, then ends the match and goes back to the start page.</li>
        <li><b>Sound:</b> a low pulse while zombies are near. At 200 m the operator warns &quot;Zombies approaching!&quot;, at 100 m you hear the
          zombies, and from 50 m the distance is spoken: 50, 40, 30, 20, 10 m. Phones that can vibrate do so when a zombie comes within 200 m. The operator calls the important
          moments over the radio: the start, checkpoints, the helicopter and the rescue.
          Set music, effects and voice under <b>SETTINGS</b> on the start page.</li>
      </ul>

      <h2>Location and your surroundings</h2>
      <ul>
        <li>Keep the app open and in front. A short switch to another app is fine; after 45 seconds away the game pauses and you tap CONTINUE.</li>
        <li>If your location is lost, the clock and the zombies stand still until it is back.</li>
        <li>Open sky gives the best location; dense forest, cliffs and tall buildings make it worse.</li>
        <li>The game tries to keep the screen on during a match, which uses battery: bring a power bank on long sessions.</li>
        <li>Look up. Watch for traffic, people and the ground in front of you, not the phone.</li>
      </ul>

      <h2>Map data and privacy</h2>
      <p>Trails and roads come from OpenStreetMap (© OpenStreetMap contributors, ODbL) and can be incomplete or wrong: a stretch in the
        game is not a promise that it is safe or allowed. The background map comes from OpenFreeMap (© OpenMapTiles), which sees your
        IP address and the map area shown. Matches and location data stay on your device; delete them under PREVIOUS GAMES.</p>

      <h2>Credits</h2>
      <p>The pictures on the start page, the New game cards, the result screens and the helicopter cards were made for OUTBREAK. Other photographs, cropped and colour-graded:</p>
      <ul>
        <li>Settings-page backdrop: “Zombie gals” by istolethetv, <a href="https://commons.wikimedia.org/wiki/File:Zombie_gals_(3261797845).jpg">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>.</li>
        <li>Jump scare: “Zombie Halloween Mask” by Sharpshotefx, <a href="https://commons.wikimedia.org/wiki/File:Zombie_Halloween_Mask.jpg">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</li>
      </ul>
    </main>
  );
}
