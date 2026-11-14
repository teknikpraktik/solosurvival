// Bygger OUTBREAKs produktionsljud (public/audio/*.mp3) från originalen i assets/audio/source/.
// Kräver ffmpeg (med libmp3lame) i PATH. Kör: node scripts/build-audio.mjs   (skriver även assets/audio/levels.json)
//
// Nivåer: varje fil får en fast förstärkning (inget komprimerat "loudness war"):
//  - mattor som loopar (hotpulser, helikopter som väntar) efter integrerad ljudstyrka (I, LUFS),
//  - korta händelseljud efter högsta momentana ljudstyrka (M, 400 ms-fönster), som bättre motsvarar hur starkt ett kort ljud upplevs.
// Förstärkningen begränsas alltid så att true peak blir högst CEILING_DBTP. Bara dörrsmällen (mycket hög toppfaktor) får en mjuk limiter.
// Uppspelningsnivåerna per ljud sätts sedan i src/app/_client/audio.ts.
// Menymusiken (redan MP3, ca 181 kbit/s VBR) kopieras oförändrad: att koda om den skulle bara ge en extra förlustgeneration.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "assets/audio/source");
const OUT = path.join(ROOT, "public/audio");
const CEILING_DBTP = -1;
const BITRATE = "128k";

/** measure: "I" = integrerad, "M" = högsta momentana. target i LUFS. */
const FILES = [
  { name: "threat-pulse-1", measure: "I", target: -24 },
  { name: "threat-pulse-2", measure: "I", target: -24 },
  { name: "threat-pulse-3", measure: "I", target: -24 },
  { name: "threat-pulse-4", measure: "I", target: -24 },
  { name: "heli-extraction", measure: "I", target: -20 },
  { name: "heli-approach", measure: "M", target: -16 },
  { name: "heli-extraction-success", measure: "M", target: -14 },
  { name: "captured", measure: "M", target: -14 },
  { name: "zombie-near", measure: "M", target: -14 },
  { name: "position-revealed", measure: "M", target: -14 },
  { name: "checkpoint-reached", measure: "M", target: -14 },
  { name: "safe-door-close", measure: "M", target: -17, limiter: true },
  // Operator voices (radio effect, static and squelch already in the files): integrated speech level, the same for all eight. The radio
  // static between the words was felt too loud in the field: a gentle downward expander (VOICE_GATE) lowers what is well below the speech
  // by up to 9 dB; the speech itself and the squelch bursts are untouched.
  { name: "keep-moving", measure: "I", target: -17, gate: true },
  { name: "safehouse-on-map", measure: "I", target: -17, gate: true },
  { name: "checkpoint-secured", measure: "I", target: -17, gate: true },
  { name: "get-to-safehouse", measure: "I", target: -17, gate: true },
  { name: "rescue-inbound", measure: "I", target: -17, gate: true },
  { name: "get-to-helicopter", measure: "I", target: -17, gate: true },
  { name: "lifting-off", measure: "I", target: -17, gate: true },
  { name: "inside-safehouse", measure: "I", target: -17, gate: true },
  { name: "checkpoint-start", measure: "I", target: -17, gate: true },
  // Spoken zombie distance (single words, mono MP3 sources, no radio effect): the loudest 400 ms, a little above the lines' speech.
  // The uploaded files were named for other numbers than they say (checked by speech recognition); the sources are named for what is said.
  { name: "countdown-50", src: "mp3", measure: "M", target: -14 },
  { name: "countdown-40", src: "mp3", measure: "M", target: -14 },
  { name: "countdown-30", src: "mp3", measure: "M", target: -14 },
  { name: "countdown-20", src: "mp3", measure: "M", target: -14 },
  { name: "countdown-10", src: "mp3", measure: "M", target: -14 },
];
const MUSIC = "theme-outbreak.mp3";
/** More themes, played at random (copied unchanged too; they are about 14 dB quieter, lifted in the player: MUSIC_TRACKS in audio.ts). */
const MORE_MUSIC = ["theme-v2.mp3", "theme-v3.mp3"];
/** Downward expander for the radio static: below −27 dBFS (RMS) the level falls 2:1, at most 9 dB; fast enough to open on every word. */
const VOICE_GATE = "agate=mode=downward:threshold=0.045:ratio=2:range=0.355:attack=8:release=180:detection=rms:knee=2";

function measure(file) {
  // ffmpeg writes the loudness summary to stderr.
  const log = execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128=peak=true -f null - 2>&1`], { encoding: "utf8" });
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf("Summary")))?.[1]);
  const TP = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(log.slice(log.lastIndexOf("Summary")))?.[1]);
  const mlog = execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -v error -i "${file}" -af "ebur128=metadata=1,ametadata=print:key=lavfi.r128.M:file=-" -f null - 2>/dev/null`], { encoding: "utf8" });
  let M = -Infinity;
  for (const m of mlog.matchAll(/lavfi\.r128\.M=(-?[\d.]+)/g)) M = Math.max(M, Number(m[1]));
  const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
  return { I, M, TP, duration };
}

const r1 = (x) => Math.round(x * 10) / 10;
mkdirSync(OUT, { recursive: true });
const report = { ceilingDbtp: CEILING_DBTP, bitrate: BITRATE, files: {} };
for (const f of FILES) {
  const src = path.join(SRC, `${f.name}.${f.src ?? "wav"}`);
  const out = path.join(OUT, `${f.name}.mp3`);
  const before = measure(src);
  const want = f.target - before[f.measure];
  const gain = f.limiter ? want : Math.min(want, CEILING_DBTP - 0.5 - before.TP); // 0,5 dB marginal för MP3-kodningens överslängar
  const af = (f.gate ? `${VOICE_GATE},` : "") + (f.limiter ? `volume=${gain.toFixed(2)}dB,alimiter=limit=${Math.pow(10, (CEILING_DBTP - 1) / 20).toFixed(4)}:attack=2:release=60:level=false` : `volume=${gain.toFixed(2)}dB`);
  execFileSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-i", src, "-af", af, "-c:a", "libmp3lame", "-b:a", BITRATE, "-ar", "48000", "-ac", "2", "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "1", out]);
  const after = measure(out);
  report.files[f.name] = {
    measure: f.measure, target: f.target, gainDb: r1(gain), limiter: !!f.limiter, gate: !!f.gate,
    before: { I: r1(before.I), M: r1(before.M), TP: r1(before.TP), bytes: statSync(src).size },
    after: { I: r1(after.I), M: r1(after.M), TP: r1(after.TP), bytes: statSync(out).size },
    durationS: Math.round(before.duration * 1000) / 1000,
  };
  console.log(`${f.name.padEnd(26)} gain ${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB  ${f.measure} ${r1(before[f.measure])} → ${r1(after[f.measure])}  TP ${r1(before.TP)} → ${r1(after.TP)}  ${statSync(src).size} → ${statSync(out).size} B`);
}
copyFileSync(path.join(SRC, MUSIC), path.join(OUT, MUSIC));
for (const f of MORE_MUSIC) {
  copyFileSync(path.join(SRC, f), path.join(OUT, f));
  const mm = measure(path.join(OUT, f));
  report.files[f.replace(/\.mp3$/, "")] = { copied: true, I: r1(mm.I), M: r1(mm.M), TP: r1(mm.TP), bytes: statSync(path.join(OUT, f)).size, durationS: Math.round(mm.duration * 1000) / 1000 };
  console.log(`${f.padEnd(26)} (kopierad)   I ${r1(mm.I)}  TP ${r1(mm.TP)}  ${statSync(path.join(OUT, f)).size} B`);
}
const m = measure(path.join(OUT, MUSIC));
report.files["theme-outbreak"] = { copied: true, I: r1(m.I), M: r1(m.M), TP: r1(m.TP), bytes: statSync(path.join(OUT, MUSIC)).size, durationS: Math.round(m.duration * 1000) / 1000 };
console.log(`theme-outbreak (kopierad)   I ${r1(m.I)}  TP ${r1(m.TP)}  ${statSync(path.join(OUT, MUSIC)).size} B`);
writeFileSync(path.join(ROOT, "assets/audio/levels.json"), JSON.stringify(report, null, 2) + "\n");
