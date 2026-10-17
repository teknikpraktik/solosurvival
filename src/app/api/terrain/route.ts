import { NextResponse } from "next/server";
import { ACTIVITIES, type Activity } from "@/config/activities";
import { fetchTerrain, graphMetadata, parseBbox, rateLimited, TerrainError } from "@/geo/osm/terrain-service";

export const maxDuration = 30;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) return NextResponse.json({ error: "För många förfrågningar." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > 10_000) {
    return NextResponse.json({ error: "För stor förfrågan." }, { status: 413 });
  }
  try {
    const body = (await req.json()) as { activity?: string; bbox?: unknown };
    if (!body.activity || !(body.activity in ACTIVITIES)) throw new TerrainError("Okänd aktivitet.", 400);
    const activity = body.activity as Activity;
    const graph = await fetchTerrain(parseBbox(body.bbox, activity), activity);
    return NextResponse.json(
      { ...graph, metadata: graphMetadata(graph) },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (e) {
    if (e instanceof TerrainError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }
}
