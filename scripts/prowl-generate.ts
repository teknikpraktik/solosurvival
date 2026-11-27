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
 * After field test 4 (2026-11-27): the breathing sounded like retching (wet, gurgling, rattling takes) and is now slow, dry and quiet, a
 * background presence; the steps are longer (22–24 s takes, ≈ 28–30 s after the build slows them) and there are six of them.
 */
const DRAG = "Slow shuffling dragging footsteps of one person walking steadily, feet scraping the ground, heavy and tired, a slow steady pace of about one step every second the whole time, no splashing, no running, no breathing.";
const DRY = "No gurgling, no retching, no coughing, no growling, no wet sounds, no splashing.";
const BREATH = `Very slow, soft, dry breathing through the nose and mouth of one person, long calm inhales and long exhales, steady the whole time, recorded close to the microphone so every breath is clearly audible. ${DRY}`;
export const PROWL_SOUNDS: { name: string; durationS: number; prompt: string; tail?: string }[] = [
  { name: "prowl-steps-1", durationS: 24, prompt: `${DRAG} On a dry gravel road.` },
  { name: "prowl-steps-2", durationS: 23, prompt: `${DRAG} On a dry forest path with pine needles and small twigs.` },
  { name: "prowl-steps-3", durationS: 24, prompt: `${DRAG} On dry asphalt, a shoe sole scuffing with every other step.` },
  { name: "prowl-steps-4", durationS: 22, prompt: `${DRAG} Through dry fallen leaves and grass.` },
  { name: "prowl-steps-5", durationS: 24, prompt: `${DRAG} On a dusty concrete pavement, one foot dragging a little behind the other.` },
  { name: "prowl-steps-6", durationS: 23, prompt: `${DRAG} On a dirt track with small stones.` },
  { name: "prowl-breath-1", durationS: 26, prompt: `${BREATH} A slight hoarseness on the exhale.` },
  { name: "prowl-breath-2", durationS: 24, prompt: `${BREATH} A faint dry rasp in the throat.` },
  { name: "prowl-breath-3", durationS: 30, prompt: `${BREATH} Tired and heavy, very even.` },
  { name: "prowl-breath-4", durationS: 25, prompt: `${BREATH} Now and then a slow sniff of the air between breaths.` },
  { name: "prowl-breath-5", durationS: 27, prompt: `${BREATH} A low faint sigh on some of the exhales.` },
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
