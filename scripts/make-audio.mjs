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

// --- Slumpad skrämma: kort, skarpt, högt skrik (0,9 s), annan klang än fångst-skriket ---
{
  const SR3 = 22050, D3 = 0.9, N3 = Math.floor(SR3 * D3);
  let sd3 = 424242;
  const r3 = () => ((sd3 = (sd3 * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const o3 = new Float32Array(N3);
  let q1 = 0, q2 = 0, hp = 0, pw = 0;
  for (let i = 0; i < N3; i++) {
    const t = i / SR3;
    const f = 1900 - 900 * t / D3 + 120 * Math.sin(2 * Math.PI * 14 * t); // fallande gällt skrik
    q1 += (2 * Math.PI * f) / SR3; q2 += (2 * Math.PI * f * 0.5) / SR3;
    const n = r3(); hp = 0.4 * hp + (n - pw) * 0.95; pw = n;
    let v = Math.sign(Math.sin(q1)) * 0.35 + Math.sin(q2) * 0.3 + hp * 0.7;
    v *= 0.7 + 0.3 * Math.sin(2 * Math.PI * 53 * t);
    const env = Math.min(1, t / 0.008) * Math.pow(1 - t / D3, 0.8);
    o3[i] = Math.tanh(v * 3.5) * env * 0.85;
  }
  const b3 = Buffer.alloc(44 + N3 * 2);
  b3.write("RIFF", 0); b3.writeUInt32LE(36 + N3 * 2, 4); b3.write("WAVEfmt ", 8); b3.writeUInt32LE(16, 16);
  b3.writeUInt16LE(1, 20); b3.writeUInt16LE(1, 22); b3.writeUInt32LE(SR3, 24); b3.writeUInt32LE(SR3 * 2, 28);
  b3.writeUInt16LE(2, 32); b3.writeUInt16LE(16, 34); b3.write("data", 36); b3.writeUInt32LE(N3 * 2, 40);
  for (let i = 0; i < N3; i++) b3.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(o3[i] * 32767))), 44 + i * 2);
  writeFileSync("public/audio/jump-scream.wav", b3);
  console.log("jump-scream.wav", b3.length, "bytes");
}

// --- Spänning: otäck, orolig dröne (2,4 s) som spelas när kartan zoomar in på zombier i cykelläget ---
{
  const SR4 = 22050, D4 = 2.4, N4 = Math.floor(SR4 * D4);
  let sd4 = 777;
  const r4 = () => ((sd4 = (sd4 * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const o4 = new Float32Array(N4);
  let a = 0, b = 0, c = 0, lp4 = 0;
  for (let i = 0; i < N4; i++) {
    const t = i / SR4;
    a += (2 * Math.PI * (62 + 8 * t)) / SR4;      // låg grundton, stigande
    b += (2 * Math.PI * (66 + 8 * t)) / SR4;      // liten sekund över: dissonans/svävning
    c += (2 * Math.PI * (233 + 40 * Math.sin(2 * Math.PI * 0.7 * t))) / SR4; // tritonus-skimmer
    lp4 += 0.05 * (r4() - lp4);
    const beat = (x) => Math.exp(-Math.pow(((t - x) * 14), 2)); // två dova hjärtslag
    const heart = Math.sin(2 * Math.PI * 48 * t) * (beat(0.55) + 0.8 * beat(0.8) + beat(1.45) + 0.8 * beat(1.7));
    const v = Math.sin(a) * 0.5 + Math.sin(b) * 0.45 + Math.sin(c) * 0.12 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3.1 * t)) + lp4 * 0.9 + heart * 0.9;
    const env = Math.min(1, t / 0.5) * Math.pow(Math.max(0, 1 - t / D4), 0.9);
    o4[i] = Math.tanh(v * 1.4) * env * 0.6;
  }
  const b4 = Buffer.alloc(44 + N4 * 2);
  b4.write("RIFF", 0); b4.writeUInt32LE(36 + N4 * 2, 4); b4.write("WAVEfmt ", 8); b4.writeUInt32LE(16, 16);
  b4.writeUInt16LE(1, 20); b4.writeUInt16LE(1, 22); b4.writeUInt32LE(SR4, 24); b4.writeUInt32LE(SR4 * 2, 28);
  b4.writeUInt16LE(2, 32); b4.writeUInt16LE(16, 34); b4.write("data", 36); b4.writeUInt32LE(N4 * 2, 40);
  for (let i = 0; i < N4; i++) b4.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(o4[i] * 32767))), 44 + i * 2);
  writeFileSync("public/audio/tension.wav", b4);
  console.log("tension.wav", b4.length, "bytes");
}

// --- Belöning: ljus, glad klockarpeggio (C–E–G–C) med glitter när en checkpoint tas (0,9 s) ---
{
  const SR5 = 22050, D5 = 0.9, N5 = Math.floor(SR5 * D5);
  const o5 = new Float32Array(N5);
  const notes = [[523.25, 0], [659.25, 0.09], [783.99, 0.18], [1046.5, 0.27]]; // frekvens, start (s)
  for (const [f, t0] of notes) {
    for (let i = Math.floor(t0 * SR5); i < N5; i++) {
      const t = i / SR5 - t0;
      const env = Math.min(1, t / 0.006) * Math.exp(-t * (f > 1000 ? 3.2 : 5.5));
      // klockklang: grundton + något ojämna övertoner
      const s = Math.sin(2 * Math.PI * f * t) + 0.45 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 9) + 0.25 * Math.sin(2 * Math.PI * f * 4 * t) * Math.exp(-t * 6);
      o5[i] += s * env * 0.22;
    }
  }
  const b5 = Buffer.alloc(44 + N5 * 2);
  b5.write("RIFF", 0); b5.writeUInt32LE(36 + N5 * 2, 4); b5.write("WAVEfmt ", 8); b5.writeUInt32LE(16, 16);
  b5.writeUInt16LE(1, 20); b5.writeUInt16LE(1, 22); b5.writeUInt32LE(SR5, 24); b5.writeUInt32LE(SR5 * 2, 28);
  b5.writeUInt16LE(2, 32); b5.writeUInt16LE(16, 34); b5.write("data", 36); b5.writeUInt32LE(N5 * 2, 40);
  for (let i = 0; i < N5; i++) b5.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(Math.tanh(o5[i] * 1.2) * 0.9 * 32767))), 44 + i * 2);
  writeFileSync("public/audio/checkpoint.wav", b5);
  console.log("checkpoint.wav", b5.length, "bytes");
}
