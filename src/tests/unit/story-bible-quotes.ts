/**
 * Story Bible continuity check: the implemented lines the Story Bible quotes word for word must still be what the campaign definition says.
 *
 * The Bible marks each such quote with the field it quotes, invisibly in the rendered page:
 *
 *   <!--q:the-fall/03.success-->**"You are inside the Waystation. …"**<!--/q-->
 *
 * Refs: `<campaign>/<mission>.intro.<n>`, `.success`, `.objective`, `.title`, `.beat.<beat id>`, and `<campaign>/epilogue.title` or
 * `epilogue.<n>`. The quoted text, without the Markdown emphasis and quote marks around it, must equal that field exactly.
 *
 * Nothing is listed twice: which lines must be quoted at all comes from the campaign definition (every intro line, every success text, every
 * line said when the mission is won, the whole epilogue), and the quotes come from the Bible. No general Markdown parsing: only the markers,
 * the section headings (`## 7.`) and straight-quoted sentences in the checked sections.
 */
import type { CampaignDef, MissionDef } from "@/campaign/types";

export interface BibleQuote { ref: string; text: string; line: number }
export interface QuoteProblem { ref?: string; line?: number; message: string }

/** The sections whose implemented quotes are all marked (7: the evacuation force, 11: THE FALL). */
export const CHECKED_SECTIONS = [7, 11] as const;

const MARKER = /<!--q:([^>]*?)-->([\s\S]*?)<!--\/q-->/g;
const lineAt = (md: string, index: number): number => md.slice(0, index).split("\n").length;
/** Inline code (`…`) blanked out, same length: a marker written as an example in backticks is documentation, not a quote. */
const withoutCode = (md: string): string => md.replace(/`[^`\n]*`/g, (s) => " ".repeat(s.length));

/** The quoted text without the Markdown around it: emphasis (`*`, `**`) and straight quote marks. Inner quote marks (“ ”) stay. */
export function plainQuote(raw: string): string {
  let t = raw.trim();
  for (let prev = ""; prev !== t;) { prev = t; t = t.replace(/^\*+([\s\S]*?)\*+$/, "$1").replace(/^"([\s\S]*)"$/, "$1").trim(); }
  return t;
}

export function bibleQuotes(md: string): BibleQuote[] {
  return [...withoutCode(md).matchAll(MARKER)].map((m) => ({ ref: m[1].trim(), text: plainQuote(m[2]), line: lineAt(md, m.index ?? 0) }));
}

const missionLabel = (c: CampaignDef, m: MissionDef) => `${c.title} ${m.id} ${m.title}`;

/** What a ref points at in the campaign: a readable name and the text it holds, or why it points at nothing. */
export function resolveRef(c: CampaignDef, ref: string): { label: string; text: string } | { error: string } {
  const slash = ref.indexOf("/");
  if (slash < 0 || ref.slice(0, slash) !== c.id) return { error: `unknown campaign in "${ref}" (expected "${c.id}/…")` };
  const parts = ref.slice(slash + 1).split(".");
  if (parts[0] === "epilogue") {
    if (parts.length !== 2) return { error: `malformed ref "${ref}"` };
    if (parts[1] === "title") return { label: `${c.title} epilogue title`, text: c.epilogue.title };
    const i = Number(parts[1]);
    if (!Number.isInteger(i) || c.epilogue.lines[i] === undefined) return { error: `${c.title} epilogue has no line ${parts[1]} (it has ${c.epilogue.lines.length})` };
    return { label: `${c.title} epilogue line ${i}`, text: c.epilogue.lines[i] };
  }
  const m = c.missions.find((x) => x.id === parts[0]);
  if (!m) return { error: `${c.title} has no mission "${parts[0]}" (ref "${ref}")` };
  const at = missionLabel(c, m);
  const [, field, key, ...rest] = parts;
  if (rest.length) return { error: `malformed ref "${ref}"` };
  if ((field === "success" || field === "objective" || field === "title") && key === undefined) return { label: `${at}, ${field}`, text: m[field] };
  if (field === "intro" && key !== undefined) {
    const i = Number(key);
    if (!Number.isInteger(i) || m.intro[i] === undefined) return { error: `${at} has no intro line ${key} (it has ${m.intro.length})` };
    return { label: `${at}, intro line ${i}`, text: m.intro[i] };
  }
  if (field === "beat" && key !== undefined) {
    const b = m.beats.find((x) => x.id === key);
    if (!b) return { error: `${at} has no radio line "${key}" (renamed, removed or moved to another mission?)` };
    return { label: `${at}, radio line ${key}`, text: b.text };
  }
  return { error: `malformed ref "${ref}"` };
}

/** Lines the Bible must quote, derived from the campaign: every intro line, the success text, every winning line, the whole epilogue. */
export function requiredRefs(c: CampaignDef): string[] {
  const out: string[] = [];
  for (const m of c.missions) {
    m.intro.forEach((_, i) => out.push(`${c.id}/${m.id}.intro.${i}`));
    out.push(`${c.id}/${m.id}.success`);
    for (const b of m.beats) {
      const t = b.trigger;
      if ((t.on === "end" && t.result === "survived") || (t.on === "objective" && t.which === "last")) out.push(`${c.id}/${m.id}.beat.${b.id}`);
    }
  }
  out.push(`${c.id}/epilogue.title`, ...c.epilogue.lines.map((_, i) => `${c.id}/epilogue.${i}`));
  return out;
}

/** Start and end (index) of a top-level section, `## <n>.` up to the next `## `; null when the heading is not there. */
export function sectionRange(md: string, n: number): [number, number] | null {
  const head = new RegExp(`^## ${n}\\. `, "m").exec(md);
  if (!head) return null;
  const next = /^## /m.exec(md.slice(head.index + 3));
  return [head.index, next ? head.index + 3 + next.index : md.length];
}

/**
 * Straight-quoted sentences in the checked sections that carry no marker: a quote of the game's own lines that nothing checks. A sentence is
 * at least three words starting with a capital letter or "…"; short lower-case phrases ("safe zone") are words, not quotes.
 */
export function unmarkedQuotes(md: string, sections: readonly number[] = CHECKED_SECTIONS): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (const n of sections) {
    const r = sectionRange(md, n);
    if (!r) continue;
    // Blank out the marked quotes (keeping the length, so line numbers stay right).
    const sec = withoutCode(md.slice(r[0], r[1])).replace(MARKER, (all) => all.replace(/[^\n]/g, " "));
    for (const m of sec.matchAll(/"([^"\n]+)"/g)) {
      const t = m[1].trim();
      if (/^[A-Z…]/.test(t) && t.split(/\s+/).length >= 3) out.push({ line: lineAt(md, r[0] + (m.index ?? 0)), text: t });
    }
    for (const m of sec.matchAll(/^> (.*\S.*)$/gm)) out.push({ line: lineAt(md, r[0] + (m.index ?? 0)), text: m[1].trim() });
  }
  return out;
}

const short = (s: string) => (s.length > 90 ? `${s.slice(0, 87)}…` : s);

/** Every way the Bible's implemented quotes and the campaign definition disagree. Empty when they agree. */
export function checkBibleQuotes(md: string, c: CampaignDef, file = "Story Bible"): QuoteProblem[] {
  const problems: QuoteProblem[] = [];
  for (const n of CHECKED_SECTIONS) {
    if (!sectionRange(md, n)) problems.push({ message: `${file}: section "## ${n}." is missing; the continuity check reads its quotes from there` });
  }
  const opened = (withoutCode(md).match(/<!--q:/g) ?? []).length;
  const quotes = bibleQuotes(md);
  if (opened !== quotes.length) problems.push({ message: `${file}: ${opened - quotes.length} quote marker(s) "<!--q:…-->" without a closing "<!--/q-->"` });

  for (const q of quotes) {
    const r = resolveRef(c, q.ref);
    if ("error" in r) { problems.push({ ref: q.ref, line: q.line, message: `${file}:${q.line}: ${r.error}` }); continue; }
    if (q.text !== r.text) {
      problems.push({ ref: q.ref, line: q.line, message: `${file}:${q.line}: ${r.label} differs.\n  Story Bible: "${q.text}"\n  Code:        "${r.text}"` });
    }
  }

  const quoted = new Set(quotes.map((q) => q.ref));
  for (const ref of requiredRefs(c)) {
    if (quoted.has(ref)) continue;
    const r = resolveRef(c, ref);
    problems.push({ ref, message: `${file}: ${"label" in r ? r.label : ref} is not quoted (no <!--q:${ref}--> marker): "${"text" in r ? short(r.text) : ""}"` });
  }

  for (const u of unmarkedQuotes(md)) {
    problems.push({ line: u.line, message: `${file}:${u.line}: quote without a <!--q:…--> marker, so nothing checks it: "${short(u.text)}"` });
  }
  return problems;
}
