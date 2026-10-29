import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  approve, buildParams, emptyManifest, estimate, expand, forbiddenEnvironment, paramsHash, plan, redact, reject, run, select, sumCost, validate,
  type Catalog, type RunDeps, type Voices,
} from "../../../audio-production/lib";

const DIR = path.resolve(import.meta.dirname, "../../../audio-production");
const cat = JSON.parse(readFileSync(path.join(DIR, "catalog.json"), "utf8")) as Catalog;
const voices = JSON.parse(readFileSync(path.join(DIR, "voices.json"), "utf8")) as Voices;
/** Röstprofiler med påhittade röst-id:n, så att tal kan planeras i testerna. */
const withVoices: Voices = { ...voices, profiles: Object.fromEntries(Object.entries(voices.profiles).map(([k, p]) => [k, { ...p, voiceId: `TestVoice${k.replace(/[^a-z]/g, "")}` }])) };

function fakeDeps(over: Partial<RunDeps> = {}): RunDeps & { files: Map<string, Uint8Array | string> } {
  const files = new Map<string, Uint8Array | string>();
  return {
    files, apiKey: "sk_test_secret", outDir: "audio-production/output", now: () => new Date("2026-10-29T12:00:00Z"), log: () => {},
    mkdir: async () => {}, writeFile: async (p, d) => { files.set(p, d); },
    fetch: vi.fn(async () => new Response(new Uint8Array(4096).fill(7), { status: 200, headers: { "content-type": "audio/mpeg", "request-id": "req_1" } })) as unknown as typeof fetch,
    ...over,
  };
}

describe("audio catalog", () => {
  it("is valid", () => {
    expect(validate(cat, voices)).toEqual([]);
  });

  it("has a 12-file sample pack with the agreed contents", () => {
    const items = select(cat, { pack: "sample" });
    expect(items).toHaveLength(12);
    const kinds = (p: string) => items.filter((i) => i.sound.product === p).map((i) => i.sound.type).sort();
    expect(kinds("adult")).toEqual(["effect", "enemy", "enemy", "voice", "voice", "voice"]);
    expect(kinds("mini")).toEqual(["effect", "enemy", "enemy", "voice", "voice", "voice"]);
    expect(items.map((i) => i.sound.id)).toEqual(expect.arrayContaining(["adult.vo.game_start", "adult.vo.enemy_nearby", "adult.vo.extraction_open", "mini.vo.checkpoint", "mini.enemy.cute_zombie", "mini.enemy.rainbow_ghost"]));
    expect(new Set(items.filter((i) => i.sound.id === "adult.enemy.growl").map((i) => i.variant.n)).size).toBe(2);
  });

  it("keeps each product's files inside its own app", () => {
    for (const i of expand(cat)) {
      if (i.sound.product === "mini") expect(i.target.startsWith("apps/mini/public/audio/")).toBe(true);
      else expect(i.target.startsWith("public/audio/")).toBe(true);
      expect(i.url.startsWith("/audio/")).toBe(true); // cached by both service workers
    }
  });

  it("has no frightening sound prompts in Mini", () => {
    for (const s of cat.sounds.filter((x) => x.product === "mini" && x.type !== "voice")) {
      for (const v of s.variants) expect(v.text).not.toMatch(/\b(scream|shriek|horror|blood|jump scare)\b/i);
    }
  });

  it("is mirrored in docs/AUDIO-SCRIPTS.md (every text, so the reviewed script is what gets generated)", () => {
    const doc = readFileSync(path.resolve(DIR, "../docs/AUDIO-SCRIPTS.md"), "utf8");
    const missing = expand(cat).filter((i) => !doc.includes(i.variant.text)).map((i) => i.variantId);
    expect(missing).toEqual([]);
  });

  it("rejects duplicate ids, bad durations and forbidden Mini words", () => {
    const bad: Catalog = structuredClone(cat);
    bad.sounds.push(structuredClone(bad.sounds[0]));
    const fx = bad.sounds.find((s) => s.type === "effect")!;
    fx.durationS = 40;
    const mv = bad.sounds.find((s) => s.product === "mini" && s.type === "voice")!;
    mv.variants[0].text = "Run, explorer!";
    const errs = validate(bad, voices).join("\n");
    expect(errs).toMatch(/duplicate id/);
    expect(errs).toMatch(/0\.5–30 s/);
    expect(errs).toMatch(/not allowed in Mini/);
  });
});

describe("selection and cost", () => {
  it("selects nothing without a pack or ids, and rejects unknown ids", () => {
    expect(select(cat, {})).toEqual([]);
    expect(() => select(cat, { ids: ["adult.vo.nope"] })).toThrow(/Unknown/);
    expect(() => select(cat, { pack: "nope" })).toThrow(/Unknown pack/);
  });

  it("filters by product and by sound or variant id", () => {
    expect(select(cat, { pack: "sample", product: "mini" })).toHaveLength(6);
    expect(select(cat, { ids: ["adult.vo.game_start"] })).toHaveLength(3);
    expect(select(cat, { ids: ["adult.vo.game_start.2"] }).map((i) => i.variantId)).toEqual(["adult.vo.game_start.2"]);
    expect(select(cat, { pack: "core" }).every((i) => i.sound.trigger !== "proposed")).toBe(true);
  });

  it("estimates voice by characters and sound effects by seconds, and marks the price uncertain", () => {
    const [vo] = select(cat, { ids: ["adult.vo.game_start.1"] });
    const p = buildParams(vo, cat, withVoices);
    if (!("params" in p)) throw new Error("blocked");
    const c = estimate(p.params, cat);
    expect(c.chars).toBe(vo.variant.text.length);
    expect(c.credits).toBe(vo.variant.text.length); // assumed 1 credit per character (multilingual v2)
    expect(c.certain).toBe(false);
    const [fx] = select(cat, { ids: ["adult.sfx.warning.1"] });
    const q = buildParams(fx, cat, voices);
    if (!("params" in q)) throw new Error("blocked");
    expect(estimate(q.params, cat).credits).toBe(40); // 1 s × 40 credits/s (documented)
    const unknown = estimate({ ...p.params, body: { ...p.params.body, model_id: "eleven_future" } } as typeof p.params, cat);
    expect(unknown.certain).toBe(false);
    expect(Number.isNaN(unknown.credits)).toBe(true);
  });

  it("puts the sample pack well under 1 000 credits per take", () => {
    const rows = plan(select(cat, { pack: "sample" }), cat, withVoices, emptyManifest());
    const sum = sumCost(rows.map((r) => r.cost!));
    expect(rows.every((r) => r.action === "generate")).toBe(true);
    expect(sum.credits).toBeGreaterThan(300);
    expect(sum.credits).toBeLessThan(1000);
  });
});

describe("plan", () => {
  it("blocks voice lines until a voice is chosen, but still estimates them", () => {
    const rows = plan(select(cat, { pack: "sample" }), cat, voices, emptyManifest());
    const vo = rows.filter((r) => r.item.sound.type === "voice");
    expect(vo.every((r) => r.action === "blocked" && r.cost && r.cost.chars > 0)).toBe(true);
    expect(rows.filter((r) => r.item.sound.type !== "voice").every((r) => r.action === "generate")).toBe(true);
  });

  it("hashes parameters stably and changes the hash when the text or voice changes", () => {
    const [vo] = select(cat, { ids: ["mini.vo.checkpoint.1"] });
    const a = buildParams(vo, cat, withVoices), b = buildParams(vo, cat, withVoices), c = buildParams(vo, cat, withVoices, { voiceId: "OtherVoice123" });
    if (!("params" in a) || !("params" in b) || !("params" in c)) throw new Error("blocked");
    expect(paramsHash(a.params)).toBe(paramsHash(b.params));
    expect(paramsHash(a.params)).not.toBe(paramsHash(c.params));
  });

  it("reuses approved and pending takes and never replaces an approved file on its own", async () => {
    const items = select(cat, { ids: ["adult.sfx.warning.1", "adult.enemy.growl.1"] });
    const first = plan(items, cat, voices, emptyManifest());
    const made = await run(first, emptyManifest(), fakeDeps());
    let m = made.manifest;
    expect(plan(items, cat, voices, m).map((r) => r.action)).toEqual(["skip-pending", "skip-pending"]);
    m = approve(m, "adult.sfx.warning.1").manifest;
    expect(plan(items, cat, voices, m).find((r) => r.item.variantId === "adult.sfx.warning.1")!.action).toBe("skip-approved");
    const changed = plan(items, cat, voices, m, { sfxModel: "eleven_text_to_sound_v3" });
    expect(changed.find((r) => r.item.variantId === "adult.sfx.warning.1")!.action).toBe("skip-stale");
    expect(plan(items, cat, voices, m, { regenerate: true }).every((r) => r.action === "generate")).toBe(true);
  });
});

describe("run (fake API)", () => {
  it("is never reached in a dry run: planning does not call fetch", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    plan(select(cat, { pack: "all" }), cat, withVoices, emptyManifest());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sends the documented request and records a traceable take", async () => {
    const d = fakeDeps();
    const rows = plan(select(cat, { ids: ["mini.vo.checkpoint.1", "mini.sfx.warning.1"] }), cat, withVoices, emptyManifest());
    const r = await run(rows, emptyManifest(), d);
    expect(r.error).toBeUndefined();
    const calls = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(calls[0][0]).toBe("https://api.elevenlabs.io/v1/text-to-speech/TestVoicemininarrator?output_format=mp3_44100_128");
    expect((calls[0][1].headers as Record<string, string>)["xi-api-key"]).toBe("sk_test_secret");
    expect(JSON.parse(calls[0][1].body as string)).toMatchObject({ text: "Awesome! You've reached a checkpoint!", model_id: "eleven_multilingual_v2" });
    expect(calls[1][0]).toBe("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128");
    expect(JSON.parse(calls[1][1].body as string)).toMatchObject({ duration_seconds: 0.8, model_id: "eleven_text_to_sound_v2", loop: false });
    const take = r.manifest.entries["mini.vo.checkpoint.1"].takes[0];
    expect(take).toMatchObject({ take: 1, status: "pending", bytes: 4096, response: { "request-id": "req_1" } });
    expect(take.file).toBe("audio-production/output/mini/mini.vo.checkpoint.1/take-1.mp3");
    // The key is never written to disk.
    for (const v of d.files.values()) if (typeof v === "string") expect(v).not.toContain("sk_test_secret");
  });

  it("stops at the first error without retrying and keeps what was made", async () => {
    let n = 0;
    const d = fakeDeps({
      fetch: vi.fn(async () => (++n === 2 ? new Response("quota_exceeded sk_test_secret", { status: 429 }) : new Response(new Uint8Array(1024), { status: 200, headers: { "content-type": "audio/mpeg" } }))) as unknown as typeof fetch,
    });
    const rows = plan(select(cat, { ids: ["adult.enemy.growl"] }), cat, voices, emptyManifest());
    const r = await run(rows, emptyManifest(), d);
    expect(n).toBe(2);
    expect(r.made).toHaveLength(1);
    expect(r.error).toMatch(/429/);
    expect(r.error).not.toContain("sk_test_secret");
  });

  it("supports approve and reject", async () => {
    const rows = plan(select(cat, { ids: ["adult.sfx.warning.1"] }), cat, voices, emptyManifest());
    const a = await run(rows, emptyManifest(), fakeDeps());
    const b = await run(plan(select(cat, { ids: ["adult.sfx.warning.1"] }), cat, voices, a.manifest, { regenerate: true }), a.manifest, fakeDeps());
    const ok = approve(b.manifest, "adult.sfx.warning.1", 1);
    expect(ok.manifest.entries["adult.sfx.warning.1"].approvedTake).toBe(1);
    const no = reject(ok.manifest, "adult.sfx.warning.1", 1);
    expect(no.entries["adult.sfx.warning.1"].approvedTake).toBeNull();
    expect(() => approve(no, "adult.sfx.warning.1", 9)).toThrow();
  });
});

describe("guards", () => {
  it("refuses CI, Vercel and test environments", () => {
    expect(forbiddenEnvironment({ CI: "true" })).toBe("CI");
    expect(forbiddenEnvironment({ VERCEL: "1" })).toBe("VERCEL");
    expect(forbiddenEnvironment({})).toBeNull();
    expect(forbiddenEnvironment(process.env)).not.toBeNull(); // Vitest sets VITEST
  });

  it("redacts the key", () => {
    expect(redact("bad key sk_abc", "sk_abc")).toBe("bad key [redacted]");
  });
});
