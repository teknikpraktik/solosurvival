/* The close-zombie layer's sounds (steps and breathing, src/play/sound-rules.ts `prowl`), generated with ElevenLabs sound effects.
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/prowl-generate.ts            every sound that has no source file yet
 *   … -- --only prowl-steps-2,prowl-breath-4                          just these (again)
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

/** Every prompt ends the same way: one source, outdoors, nothing musical and no words (a voice would read as a person, not a threat). */
const TAIL = "Outdoors at night, natural, no music, no words, no voice.";
export const PROWL_SOUNDS: { name: string; durationS: number; prompt: string }[] = [
  { name: "prowl-steps-1", durationS: 3, prompt: "Slow uneven dragging footsteps on gravel, one foot scraping, a single person shambling closer." },
  { name: "prowl-steps-2", durationS: 3, prompt: "Heavy stumbling footsteps on wet asphalt, irregular rhythm, a shoe dragging." },
  { name: "prowl-steps-3", durationS: 3, prompt: "Footsteps shuffling slowly through dry leaves and twigs in a forest, limping gait." },
  { name: "prowl-steps-4", durationS: 3, prompt: "Bare feet slapping slowly on a wet road, uneven limping gait." },
  { name: "prowl-steps-5", durationS: 3.5, prompt: "Clear shambling footsteps on a dirt path, shuffling and dragging, five or six steps." },
  { name: "prowl-steps-6", durationS: 3, prompt: "Slow footsteps on grass and earth, limping, a twig snaps under a foot." },
  { name: "prowl-breath-1", durationS: 3, prompt: "Ragged wet rasping breathing of a very sick person, slow inhale and exhale, close." },
  { name: "prowl-breath-2", durationS: 3, prompt: "Low guttural growling breath, raspy and hungry, a single creature." },
  { name: "prowl-breath-3", durationS: 3, prompt: "Hoarse wheezing breath with a rattling throat, slow and menacing." },
  { name: "prowl-breath-4", durationS: 2.5, prompt: "Heavy panting with a low gurgle in the throat, animal-like." },
  { name: "prowl-breath-5", durationS: 3, prompt: "A choked gasping inhale followed by a long rattling exhale." },
  { name: "prowl-breath-6", durationS: 3, prompt: "Snarling breath through clenched teeth, sniffing the air, close and clearly audible." },
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
    const text = `${s.prompt} ${TAIL}`;
    const audio = await collect(await client.textToSoundEffects.convert({ text, durationSeconds: s.durationS, promptInfluence: INFLUENCE, outputFormat: "mp3_44100_128" }));
    if (audio.length < 2000) throw new Error(`${s.name}: no audio returned (${audio.length} bytes)`);
    writeFileSync(path.join(SRC, `${s.name}.mp3`), audio);
    rec[s.name] = { text, durationSeconds: s.durationS, promptInfluence: INFLUENCE, generated: new Date().toISOString().slice(0, 10) };
    console.log(`  ${s.name}  ${audio.length} B`);
  }
  writeFileSync(recFile, JSON.stringify(Object.fromEntries(Object.entries(rec).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
}
