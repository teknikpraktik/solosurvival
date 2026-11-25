/* Generated sound effects (ElevenLabs): the close-zombie layer (steps and breathing, src/play/sound-rules.ts `prowl`) and the screams of
 * a new infected (someone bitten and turning; SoundEvent "infected").
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/prowl-generate.ts            every sound that has no source file yet
 *   … -- --only prowl-steps-2,infected-3                              just these (again)
 *   … -- --dry-run                                                    what would be generated
 * Writes the raw takes to assets/audio/source/<name>.mp3 and what they were made with to assets/audio/source/prowl-takes.json.
 * Then `node scripts/build-audio.mjs --only <names>` levels them into public/audio/. The key is read from ELEVENLABS_API_KEY by the SDK.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const root = path.join(import.meta.dirname, "..");
const SRC = path.join(root, "assets", "audio", "source");
const args = process.argv.slice(2);
const only = args.includes("--only") ? new Set((args[args.indexOf("--only") + 1] ?? "").split(",")) : null;

/** The close-zombie prompts end the same way: one source, outdoors, nothing musical and no words (a voice would read as a person). */
const TAIL = "Outdoors at night, natural, no music, no words, no voice.";
/** A new infected is somebody else, further off: a person (a voice, but no words) attacked, bitten and turning. */
const BITE_TAIL = "Horror, outdoors at night, some distance away, natural, no music, no words.";
/**
 * After the field test: the steps are long, slow, dragging passages (≈ 20 s, one shuffling walker on a dry surface; the short takes
 * sounded like a child running through a puddle). After field test 3 the breathing is long too (20–30 s takes; the short ones were too
 * short), and the screams are a whole attack: someone bitten, screaming, turning.
 */
const DRAG = "Slow shuffling dragging footsteps of one person limping, feet scraping the ground, heavy and tired, a slow steady pace of about one step every second, no splashing, no running.";
const BREATH = "One creature breathing steadily the whole time, close, each breath clearly heard, short natural pauses between breaths.";
export const PROWL_SOUNDS: { name: string; durationS: number; prompt: string; tail?: string }[] = [
  { name: "prowl-steps-1", durationS: 20, prompt: `${DRAG} On a dry gravel road.` },
  { name: "prowl-steps-2", durationS: 20, prompt: `${DRAG} On a dry forest path with pine needles and small twigs.` },
  { name: "prowl-steps-3", durationS: 20, prompt: `${DRAG} On dry asphalt, a shoe sole scuffing with every other step.` },
  { name: "prowl-steps-4", durationS: 20, prompt: `${DRAG} Through dry fallen leaves and grass.` },
  { name: "prowl-breath-1", durationS: 25, prompt: `Ragged wet rasping breathing of a very sick person, slow inhale and exhale. ${BREATH}` },
  { name: "prowl-breath-2", durationS: 28, prompt: `Low guttural growling breaths, raspy and hungry, now and then a low growl. ${BREATH}` },
  { name: "prowl-breath-3", durationS: 22, prompt: `Hoarse wheezing breathing with a rattling throat, slow and menacing. ${BREATH}` },
  { name: "prowl-breath-4", durationS: 30, prompt: `Slow labored breathing through the mouth with a faint groan on some exhales, a wet throat. ${BREATH}` },
  { name: "prowl-breath-5", durationS: 24, prompt: `Raspy hungry breathing that speeds up, then a low growl, then slows again, sniffing the air between breaths. ${BREATH}` },
  { name: "prowl-breath-6", durationS: 26, prompt: `Deep hollow breathing, slow and heavy, a rattle deep in the chest, an occasional choked gasp. ${BREATH}` },
  { name: "infected-1", durationS: 10, tail: BITE_TAIL, prompt: "A man is attacked and bitten by a zombie. A struggle and a terrified shout, a wet bite and tearing, then a long agonized scream that breaks into choking and a guttural snarl." },
  { name: "infected-2", durationS: 11, tail: BITE_TAIL, prompt: "A woman is grabbed and bitten by a zombie. A sharp cry of surprise, struggling and growling, a wet crunching bite, then a long piercing scream of pain that fades into gasps and a hoarse snarl." },
  { name: "infected-3", durationS: 12, tail: BITE_TAIL, prompt: "A person is pulled down by snarling zombies. Panicked screaming, a scuffle, a crunching bite, a long terrible scream that cuts off into gurgling, then a low inhuman groan." },
  { name: "infected-4", durationS: 12, tail: BITE_TAIL, prompt: "A man fights off an attacker, grunts and a growl, a bite, then a long rising scream of agony that turns hoarse and inhuman and ends in a rasping zombie groan." },
];
const INFLUENCE = 0.6;

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) chunks.push(value); }
  return Buffer.concat(chunks);
}

{
  const todo = PROWL_SOUNDS.filter((s) => (only ? only.has(s.name) : !existsSync(path.join(SRC, `${s.name}.mp3`))));
  console.log(`${PROWL_SOUNDS.length} sounds; ${todo.length} to generate`);
  if (args.includes("--dry-run")) { for (const s of todo) console.log(`  ${s.name}  ${s.durationS} s  ${s.prompt}`); process.exit(0); }
  const client = new ElevenLabsClient();
  const recFile = path.join(SRC, "prowl-takes.json");
  const rec = existsSync(recFile) ? (JSON.parse(readFileSync(recFile, "utf8")) as Record<string, unknown>) : {};
  for (const s of todo) {
    const text = `${s.prompt} ${s.tail ?? TAIL}`;
    const audio = await collect(await client.textToSoundEffects.convert({ text, durationSeconds: s.durationS, promptInfluence: INFLUENCE, outputFormat: "mp3_44100_128" }));
    if (audio.length < 2000) throw new Error(`${s.name}: no audio returned (${audio.length} bytes)`);
    writeFileSync(path.join(SRC, `${s.name}.mp3`), audio);
    rec[s.name] = { text, durationSeconds: s.durationS, promptInfluence: INFLUENCE, generated: new Date().toISOString().slice(0, 10) };
    console.log(`  ${s.name}  ${audio.length} B`);
  }
  writeFileSync(recFile, JSON.stringify(Object.fromEntries(Object.entries(rec).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
}
