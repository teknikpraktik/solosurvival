/* Campaign voice lines with ElevenLabs: generates the takes and builds the files the game plays.
 *   npm run campaign:voice:generate                       every line that has no take yet, then build all
 *   npm run campaign:voice:generate -- --only tf-m01-start,tf-m01-win   just these (again, replacing their takes)
 *   npm run campaign:voice:generate -- --force            every line again (costs the whole script in characters)
 *   npm run campaign:voice:generate -- --build            no generation: only rebuild the game files from the takes
 *   npm run campaign:voice:generate -- --dry-run          what would be generated, and how many characters
 *
 * Two steps, so the sound treatment can be changed without paying for the speech again:
 *   1. Takes: assets/audio/campaign/<campaign>/<beat id>.mp3, the voice as ElevenLabs returns it (dry, 44.1 kHz, 128 kbit/s).
 *      The voice of each speaker is `elevenLabsVoiceId` in the campaign definition; the text is the beat's text, word for word.
 *   2. Game files: public/campaign/<campaign>/voice/<beat id>.mp3, the take through a radio chain (telephone band, compression, a
 *      little grit, a squelch burst before and after) and levelled like the game's other operator lines (−17 LUFS integrated,
 *      true peak ≤ −1.5 dBTP). Then `campaign:voice` writes the manifest that tells the game which lines exist.
 *
 * The narration (src/campaign/narration.ts: the briefing before and the debrief after each mission, read by the campaign's narrator) goes
 * the same two steps, without the radio: takes in assets/audio/campaign/<campaign>/narration/, game files in
 * public/campaign/<campaign>/narration/ (clean voice, a gentle compressor, −18 LUFS). `--only` takes narration ids too.
 *
 * The API key is read from ELEVENLABS_API_KEY by the SDK (never written in code or printed). Needs ffmpeg for step 2.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { CAMPAIGNS } from "../src/campaign";
import { chapterNarrations } from "../src/campaign/narration";
import type { Speaker, StoryBeat } from "../src/campaign/types";

const root = path.join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const only = args.includes("--only") ? new Set((args[args.indexOf("--only") + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) : null;

const MODEL = "eleven_multilingual_v2";
const OUTPUT = "mp3_44100_128";
const TARGET_LUFS = -17;
/** The narrator is a voice in the room, not a radio: a little below the operator so a briefing never sounds louder than the game. */
const NARRATION_LUFS = -18;
const CEILING_DBTP = -1.5;

/** The narrator: steady, a little slower than speech, some colour. */
const NARRATION_SETTINGS = { stability: 0.5, similarityBoost: 0.8, style: 0.22, useSpeakerBoost: true, speed: 0.94 };
/** Calm and steady for procedure; less steady and more expressive when the player is about to be caught. */
function settings(b: StoryBeat) {
  const urgent = b.trigger.on === "contact" || /!/.test(b.text);
  return urgent
    ? { stability: 0.32, similarityBoost: 0.8, style: 0.4, useSpeakerBoost: true, speed: 1.06 }
    : { stability: 0.55, similarityBoost: 0.8, style: 0.12, useSpeakerBoost: true, speed: 1.0 };
}
/** The same line always asks for the same take (a fixed seed from its id), so a rebuild elsewhere gives the same performance where the service allows. */
const seedOf = (id: string) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 4_000_000_000;

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) chunks.push(value); }
  return Buffer.concat(chunks);
}

/**
 * The radio chain. Ground: a narrow telephone band, firm compression and a little clipping. Aircraft: narrower and harder driven, with
 * cockpit noise under the voice. Both open and close with a short squelch burst; the bed of static under the speech is kept low (in the
 * field the static of the first recorded lines was felt too loud).
 */
function radioFilter(kind: Speaker["radio"], durationS: number): string {
  const air = kind === "aircraft";
  const lead = 0.22, tail = 0.3, total = durationS + lead + tail;
  const voice = [
    `adelay=${Math.round(lead * 1000)}:all=1`, `apad=pad_dur=${tail}`,
    `highpass=f=${air ? 420 : 330}:poles=2`, `lowpass=f=${air ? 2900 : 3300}:poles=2`,
    "acompressor=threshold=0.09:ratio=5:attack=4:release=90:makeup=3",
    `asoftclip=type=tanh:threshold=${air ? 0.55 : 0.7}`,
    `highpass=f=${air ? 420 : 330}`, `lowpass=f=${air ? 2900 : 3300}`,
  ].join(",");
  // Static: band-limited noise, low under the speech, with a burst as the channel opens and one as it closes.
  const bed = air ? 0.03 : 0.012;
  const env = `'${bed}+0.16*between(t,0.03,0.13)+0.14*between(t,${(total - 0.2).toFixed(2)},${(total - 0.08).toFixed(2)})'`;
  const noise = `anoisesrc=color=${air ? "brown" : "white"}:duration=${total.toFixed(2)}:sample_rate=48000:seed=7,highpass=f=${air ? 250 : 700},lowpass=f=${air ? 2400 : 3600},volume=${env}:eval=frame`;
  return `[0:a]aresample=48000,aformat=channel_layouts=mono,${voice}[v];${noise}[n];[v][n]amix=inputs=2:duration=shortest:normalize=0,pan=stereo|c0=c0|c1=c0[m]`;
}

function loudness(file: string): { I: number; TP: number; duration: number } {
  const log = execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128=peak=true -f null - 2>&1`], { encoding: "utf8" });
  const sum = log.slice(log.lastIndexOf("Summary"));
  const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
  return { I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1]), TP: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1]), duration };
}

/** The narrator: no radio. Rumble out, a gentle compressor, a short breath of silence at both ends so it never starts on a click. */
const NARRATION_FILTER = "[0:a]aresample=48000,aformat=channel_layouts=mono,adelay=150:all=1,apad=pad_dur=0.35,highpass=f=70,acompressor=threshold=0.18:ratio=2.5:attack=8:release=160:makeup=1.5,pan=stereo|c0=c0|c1=c0[m]";

type Chain = Speaker["radio"] | "narration";
function build(take: string, out: string, kind: Chain): { I: number; TP: number; duration: number; bytes: number } {
  const tmp = `${out}.tmp.wav`;
  const dur = loudness(take).duration;
  const target = kind === "narration" ? NARRATION_LUFS : TARGET_LUFS;
  execFileSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-i", take, "-filter_complex", kind === "narration" ? NARRATION_FILTER : radioFilter(kind, dur), "-map", "[m]", "-c:a", "pcm_s16le", tmp]);
  const encode = (gainDb: number) => execFileSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-i", tmp, "-af", `volume=${gainDb.toFixed(2)}dB`, "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "1", out]);
  const m = loudness(tmp);
  const limit = CEILING_DBTP - 0.5 - m.TP;
  let gain = Math.min(target - m.I, limit);
  encode(gain);
  // The encoded stereo file does not measure exactly like the mono working file: correct once from what actually came out.
  const got = loudness(out);
  if (Math.abs(target - got.I) > 0.3) { gain = Math.min(gain + (target - got.I), limit); encode(gain); }
  execFileSync("rm", ["-f", tmp]);
  return { ...loudness(out), bytes: statSync(out).size };
}

/** One file to make: a radio line or a narration. `dir`: where its takes.json lives. */
interface Job { campaign: string; id: string; text: string; voiceId: string | undefined; who: string; settings: Record<string, unknown>; chain: Chain; take: string; out: string; dir: string }
const jobs: Job[] = [];
for (const c of CAMPAIGNS) {
  const takes = path.join(root, "assets", "audio", "campaign", c.id);
  for (const m of c.missions) for (const b of m.beats) {
    const speaker = c.speakers.find((s) => s.id === b.speaker);
    if (!speaker) throw new Error(`${b.id}: unknown speaker ${b.speaker}`);
    jobs.push({ campaign: c.id, id: b.id, text: b.text, voiceId: speaker.elevenLabsVoiceId, who: speaker.name, settings: settings(b), chain: speaker.radio, dir: takes,
      take: path.join(takes, `${b.id}.mp3`), out: path.join(root, "public", "campaign", c.id, "voice", `${b.id}.mp3`) });
  }
  if (!c.narrator) continue;
  for (const n of chapterNarrations(c)) {
    jobs.push({ campaign: c.id, id: n.id, text: n.text, voiceId: c.narrator.elevenLabsVoiceId, who: "NARRATOR", settings: NARRATION_SETTINGS, chain: "narration", dir: path.join(takes, "narration"),
      take: path.join(takes, "narration", `${n.id}.mp3`), out: path.join(root, "public", "campaign", c.id, "narration", `${n.id}.mp3`) });
  }
}
if (only) for (const id of only) if (!jobs.some((j) => j.id === id)) throw new Error(`--only: no radio line or narration with the id ${id}`);

const toGenerate = flag("--build") ? [] : jobs.filter((j) => (only ? only.has(j.id) : flag("--force") || !existsSync(j.take)));
const chars = toGenerate.reduce((n, j) => n + j.text.length, 0);
console.log(`${jobs.length} lines; ${toGenerate.length} to generate (${chars} characters)`);
if (flag("--dry-run")) { for (const j of toGenerate) console.log(`  ${j.id}  ${j.who}  ${j.text.length} chars`); process.exit(0); }

if (toGenerate.length) {
  if (!process.env.ELEVENLABS_API_KEY) { console.error("ELEVENLABS_API_KEY is not set (put it in the environment, never in code)."); process.exit(1); }
  const client = new ElevenLabsClient();
  for (const j of toGenerate) {
    if (!j.voiceId) throw new Error(`${j.who} has no elevenLabsVoiceId in the campaign definition`);
    const audio = await collect(await client.textToSpeech.convert(j.voiceId, {
      text: j.text, modelId: MODEL, outputFormat: OUTPUT, languageCode: "en", voiceSettings: j.settings, seed: seedOf(j.id),
    }));
    if (audio.length < 2000 || !(audio[0] === 0xff || audio.subarray(0, 3).toString() === "ID3")) throw new Error(`${j.id}: the service did not return an MP3 (${audio.length} bytes)`);
    mkdirSync(path.dirname(j.take), { recursive: true });
    writeFileSync(j.take, audio);
    console.log(`  take  ${j.id}  ${j.who}  ${audio.length} B`);
  }
}

let built = 0;
for (const j of jobs) {
  if (!existsSync(j.take)) continue;
  if (only && !only.has(j.id) && existsSync(j.out)) continue;
  mkdirSync(path.dirname(j.out), { recursive: true });
  const r = build(j.take, j.out, j.chain);
  built++;
  console.log(`  built ${j.id.padEnd(22)} ${r.duration.toFixed(1)} s  I ${r.I.toFixed(1)} LUFS  TP ${r.TP.toFixed(1)} dBTP  ${r.bytes} B`);
}
// A record of what the takes were made with, next to them (for whoever regenerates a line later).
for (const dir of new Set(toGenerate.map((j) => j.dir))) {
  const file = path.join(dir, "takes.json");
  const prev = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  for (const j of toGenerate.filter((x) => x.dir === dir)) prev[j.id] = { speaker: j.who, voiceId: j.voiceId, model: MODEL, settings: j.settings, seed: seedOf(j.id), text: j.text };
  writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(prev).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
}
console.log(`built ${built} game files. Now run: npm run campaign:voice`);
