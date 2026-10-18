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

// --- Fångad: skrik (kort, skärande, förvrängt) ---
{
  const SR2 = 22050, D2 = 1.8, N2 = Math.floor(SR2 * D2);
  let sd = 987654;
  const r2 = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const o = new Float32Array(N2);
  let p1 = 0, p2 = 0, p3 = 0, nz = 0, prevN = 0;
  for (let i = 0; i < N2; i++) {
    const t = i / SR2;
    const f = 620 + 1250 * (1 - Math.exp(-t * 3.2)) + 55 * Math.sin(2 * Math.PI * 9 * t) + 30 * Math.sin(2 * Math.PI * 23 * t);
    p1 += (2 * Math.PI * f) / SR2; p2 += (2 * Math.PI * f * 1.51) / SR2; p3 += (2 * Math.PI * f * 2.02) / SR2;
    const saw = (x) => ((x / Math.PI) % 2) - 1;
    const white = r2(); nz = 0.55 * nz + (white - prevN) * 0.9; prevN = white; // högpassat brus (väsande)
    let s = saw(p1) * 0.55 + Math.sign(Math.sin(p2)) * 0.25 + saw(p3) * 0.2 + nz * 0.55;
    s *= 0.65 + 0.35 * Math.sin(2 * Math.PI * 37 * t); // grovt, hest
    const thud = Math.sin(2 * Math.PI * (90 - 40 * t) * t) * Math.exp(-t * 9) * 1.2;
    const env = Math.min(1, t / 0.025) * (t < 1.35 ? 1 : Math.pow(1 - (t - 1.35) / 0.45, 1.5));
    o[i] = Math.tanh((s * 3.2 + thud) * 1.2) * env * 0.8;
  }
  const b = Buffer.alloc(44 + N2 * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + N2 * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR2, 24); b.writeUInt32LE(SR2 * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(N2 * 2, 40);
  for (let i = 0; i < N2; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(o[i] * 32767))), 44 + i * 2);
  writeFileSync("public/audio/captured-scream.wav", b);
  console.log("captured-scream.wav", b.length, "bytes");
}
