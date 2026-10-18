// Genererar det lokala närhetsljudet (public/audio/zombie-near.wav): kort, lågt, obehagligt morrande med tritonus-dissonans.
// Deterministiskt, inga beroenden. Kör: node scripts/make-audio.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const SR = 22050, DUR = 0.9, N = Math.floor(SR * DUR);
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const out = new Float32Array(N);
let ph1 = 0, ph2 = 0, lp = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const f = 95 - 38 * (t / DUR); // fallande grundton
  ph1 += (2 * Math.PI * f) / SR;
  ph2 += (2 * Math.PI * f * 1.414) / SR; // tritonus
  const saw = (x) => ((x / Math.PI) % 2) - 1;
  const growl = 0.55 + 0.45 * Math.sin(2 * Math.PI * 17 * t); // amplitudmodulering
  lp += 0.08 * (rnd() - lp); // lågpassat brus
  const s = (saw(ph1) * 0.5 + saw(ph2) * 0.3 + lp * 1.4) * growl;
  const env = Math.min(1, t / 0.06) * Math.pow(1 - t / DUR, 1.6);
  out[i] = Math.tanh(s * 1.6) * env * 0.55;
}
const buf = Buffer.alloc(44 + N * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(out[i] * 32767))), 44 + i * 2);
mkdirSync("public/audio", { recursive: true });
writeFileSync("public/audio/zombie-near.wav", buf);
console.log("zombie-near.wav", buf.length, "bytes");
