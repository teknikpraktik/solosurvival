/* Campaign voice files: the recording script and the list of what has been recorded.
 *   npm run campaign:voice            writes both, prints what is missing
 *   npm run campaign:voice -- --check fails if either file is out of date (for CI) or a recording has no beat
 *
 * For every campaign in src/campaign:
 *   docs/campaign/<id>-voice-script.csv   one row per radio line: file name, speaker, voice direction, trigger, text (import into ElevenLabs
 *                                         or hand to a voice actor; the file name is what the game looks for)
 *   src/campaign/voice-manifest.ts        which lines have a file in public/campaign/<id>/voice/ (the game only asks for those)
 *   docs/campaign/<id>-narration-script.csv  the narrator's reads between missions (briefing, debrief), built from the mission texts
 *   RECORDED_NARRATION in the manifest    which narrations have a file in public/campaign/<id>/narration/
 * Workflow: generate <beat id>.mp3 per row, put the files in public/campaign/<id>/voice/, run this script, commit.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CAMPAIGNS } from "../src/campaign";
import { chapterNarrations } from "../src/campaign/narration";
import type { Trigger } from "../src/campaign/types";

const root = path.join(import.meta.dirname, "..");
const check = process.argv.includes("--check");
let stale = false;
let problems = 0;

function trigger(t: Trigger): string {
  switch (t.on) {
    case "start": return "mission start";
    case "time": return t.atS !== undefined ? `${t.atS} s into the mission` : t.atFrac !== undefined ? `${Math.round(t.atFrac * 100)} % of the time limit` : `${t.beforeEndS} s before the time limit`;
    case "hunt": return "first time the infected have the player's position";
    case "contact": return "first time an infected is on the player (urgent)";
    case "intercept": return "first time an infected cuts ahead of the player";
    case "objective": return `${t.which} goal confirmed`;
    case "transmit": return `signal transmission ${t.change}`;
    case "goal": return t.withinM !== undefined ? `${t.withinM} m from the goal` : `${Math.round((t.covered ?? 0) * 100)} % of the way to the goal`;
    case "heli_inbound": return "helicopter one minute out";
    case "heli_landed": return "helicopter landed (extraction open)";
    case "end": return `mission over: ${t.result === "survived" ? "won" : t.result === "infected" ? "caught" : "out of time"}`;
  }
}
const csv = (cells: string[]) => cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
function put(file: string, content: string) {
  const cur = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (cur === content) return;
  stale = true;
  if (check) { console.error(`out of date: ${path.relative(root, file)}`); return; }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`wrote ${path.relative(root, file)}`);
}

const recorded: Record<string, string[]> = {};
const narrated: Record<string, string[]> = {};
for (const c of CAMPAIGNS) {
  const rows = [csv(["file", "mission", "speaker", "voice direction", "trigger", "stand-in until recorded", "text"])];
  const ids = new Set<string>();
  for (const m of c.missions) for (const b of m.beats) {
    ids.add(b.id);
    const sp = c.speakers.find((s) => s.id === b.speaker);
    rows.push(csv([`${b.id}.mp3`, `${m.id} ${m.title}`, sp?.name ?? b.speaker, sp?.voice ?? "", trigger(b.trigger), b.fallbackVoice ?? "(text and a chime)", b.text]));
  }
  put(path.join(root, "docs", "campaign", `${c.id}-voice-script.csv`), rows.join("\n") + "\n");
  const dir = path.join(root, "public", "campaign", c.id, "voice");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".mp3")).map((f) => f.slice(0, -4)).sort() : [];
  for (const f of files) if (!ids.has(f)) { problems++; console.error(`${c.id}: ${f}.mp3 has no radio line with that id (renamed or removed?)`); }
  recorded[c.id] = files.filter((f) => ids.has(f));
  const missing = [...ids].filter((id) => !recorded[c.id].includes(id));
  console.log(`${c.id}: ${recorded[c.id].length} of ${ids.size} lines recorded${missing.length ? `, ${missing.length} to record` : ""}`);

  // The narrator. A take whose text no longer matches the screens it reads is reported (regenerate it with --only <id>).
  const narrations = chapterNarrations(c);
  put(path.join(root, "docs", "campaign", `${c.id}-narration-script.csv`), [csv(["file", "mission", "kind", "voice direction", "text"]),
    ...narrations.map((n) => csv([`${n.id}.mp3`, n.id.replace(/^.*-m(\d+)-.*$/, "$1"), n.kind, c.narrator?.voice ?? "", n.text]))].join("\n") + "\n");
  const nDir = path.join(root, "public", "campaign", c.id, "narration");
  const nFiles = existsSync(nDir) ? readdirSync(nDir).filter((f) => f.endsWith(".mp3")).map((f) => f.slice(0, -4)).sort() : [];
  const nIds = new Set(narrations.map((n) => n.id));
  for (const f of nFiles) if (!nIds.has(f)) { problems++; console.error(`${c.id}: narration ${f}.mp3 has no narration with that id`); }
  narrated[c.id] = nFiles.filter((f) => nIds.has(f));
  const takesFile = path.join(root, "assets", "audio", "campaign", c.id, "narration", "takes.json");
  const takes = existsSync(takesFile) ? (JSON.parse(readFileSync(takesFile, "utf8")) as Record<string, { text?: string }>) : {};
  for (const n of narrations) if (narrated[c.id].includes(n.id) && takes[n.id] && takes[n.id].text !== n.text) console.warn(`${c.id}: ${n.id} was recorded from another text than the screen shows now (regenerate it)`);
  console.log(`${c.id}: ${narrated[c.id].length} of ${narrations.length} narrations recorded`);
}

put(path.join(root, "src", "campaign", "voice-manifest.ts"), `/**
 * Which story beats have a recording, per campaign. GENERATED by \`npm run campaign:voice\` (scripts/campaign-voice.ts) from the files in
 * public/campaign/<campaign>/voice/ — do not edit by hand. A beat that is not listed is shown as text and gets its stand-in line or a
 * chime, so the game never asks for a file that is not there.
 */
export const RECORDED_BEATS: Record<string, readonly string[]> = ${JSON.stringify(recorded, null, 2).replace(/\[\s+\]/g, "[]")};

/** Which narrations (src/campaign/narration.ts: briefing, debrief) have a recording, per campaign. A missing one is only text. */
export const RECORDED_NARRATION: Record<string, readonly string[]> = ${JSON.stringify(narrated, null, 2).replace(/\[\s+\]/g, "[]")};
`);
if (check && (stale || problems)) process.exit(1);
if (problems) process.exit(1);
