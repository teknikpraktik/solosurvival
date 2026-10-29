import { PageHeader } from "@/app/_client/Modal";
import { Critters } from "../../client/Critters";
import { SAFETY_NOTE, SAFETY_POINTS } from "../../client/text";

export const metadata = { title: "How to play – Mini Outbreak" };

export default function HowToPlay() {
  return (
    <main className="page">
      <PageHeader title="HOW TO PLAY" />

      <section className="card safety">
        <h2>Safety first</h2>
        <ul>{SAFETY_POINTS.map((s) => <li key={s}>{s}</li>)}</ul>
        <p className="muted">{SAFETY_NOTE}</p>
      </section>

      <h2>The critters</h2>
      <p>Four kinds of friendly critters walk along real paths and roads: Cute Zombies, Rainbow Ghosts, Rainbow Spiders and Cute Mini Monsters. They are all mixed together in every game and they all move the same way.</p>
      <Critters size={60} labels className="critters legend" />

      <h2>The idea</h2>
      <p>You walk in the real world with the phone. The game follows where you are. If a critter stays right next to you for a few seconds, it catches you and the game ends. Then you can simply try again.</p>

      <h2>Three games</h2>
      <ul>
        <li><b>CHECKPOINTS</b> – find the numbered checkpoints in order, then walk back home. You choose the way.</li>
        <li><b>A TO B</b> – A is where you are. Tap the map to pick B and walk there before the time runs out.</li>
        <li><b>SURVIVAL</b> – stay away from the critters. After a while a helicopter lands (EXIT on the map). Walk to it before the time runs out.</li>
      </ul>

      <h2>The map</h2>
      <ul>
        <li>The blue arrow is you.</li>
        <li>The next checkpoint is blue and turns green when you have taken it. If it is off the screen, a small blue arrow at the edge points to it.</li>
        <li>The 👀 number at the top shows how far away the nearest critter is.</li>
        <li>AUTO (green) makes the map follow you. Touch the map to move it yourself; tap AUTO to follow again.</li>
      </ul>

      <h2>Pause and stop</h2>
      <p>Tap PAUSE whenever you need to, for example to cross a road safely. The clock and the critters wait. Tap STOP to end the game. Stopping is always OK.</p>
      <p>Keep the app open on the screen while you play, so it knows where you are.</p>
    </main>
  );
}
