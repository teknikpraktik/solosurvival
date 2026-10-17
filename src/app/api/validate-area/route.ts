import { NextResponse } from "next/server";
import { ACTIVITIES, type Activity } from "@/config/activities";
import { DIFFICULTIES, type Difficulty } from "@/config/difficulty";
import { clipGraphToPolygon, indexAndValidate, validatePolygon } from "@/geo/validation/area";
import { fetchTerrain, rateLimited, TerrainError } from "@/geo/osm/terrain-service";
import type { Bbox } from "@/geo/osm/overpass";

export const maxDuration = 30;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) return NextResponse.json({ error: "För många förfrågningar." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > 50_000) {
    return NextResponse.json({ error: "För stor förfrågan." }, { status: 413 });
  }
  try {
    const b = (await req.json()) as {
      activity?: string;
      difficulty?: string;
      durationSeconds?: number;
      polygon?: unknown;
      start?: { lat: number; lon: number };
    };
    if (!b.activity || !(b.activity in ACTIVITIES)) throw new TerrainError("Okänd aktivitet.", 400);
    if (!b.difficulty || !(b.difficulty in DIFFICULTIES)) throw new TerrainError("Okänd svårighetsgrad.", 400);
    const dur = Number(b.durationSeconds);
    if (!Number.isFinite(dur) || dur < 20 * 60 || dur > 90 * 60) throw new TerrainError("Matchlängd måste vara 20–90 minuter.", 400);
    const activity = b.activity as Activity;

    const poly = validatePolygon(b.polygon, activity);
    if ("error" in poly) return NextResponse.json({ valid: false, warnings: [poly.error], metrics: null }, { status: 200 });

    const lons = poly.ring.map((c) => c[0]);
    const lats = poly.ring.map((c) => c[1]);
    const bbox: Bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
    const sg = clipGraphToPolygon(await fetchTerrain(bbox, activity), poly.ring);
    const { validation } = indexAndValidate(sg, {
      activity,
      difficulty: b.difficulty as Difficulty,
      durationS: dur,
      start: b.start,
    });
    const { component: _c, ...out } = validation;
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof TerrainError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }
}
