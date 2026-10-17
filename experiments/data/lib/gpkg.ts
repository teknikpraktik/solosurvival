// GeoPackage-läsare för Lantmäteriets Topografi 10/50 (SWEREF 99 TM). Node-only (node:sqlite).
import { DatabaseSync } from "node:sqlite";
import { buildGraph, type RawWay } from "@/geo/graph/build";
import type { PathType, SerializedGraph } from "@/geo/graph/types";

// --- SWEREF 99 TM (EPSG:3006) <-> WGS84. Transversell Mercator, GRS80 (Krüger-serier, Lantmäteriets parametrar). ---
const A = 6378137, F = 1 / 298.257222101, K0 = 0.9996, LON0 = 15, FE = 500000;
const E2 = F * (2 - F), N_ = F / (2 - F);
const AH = (A / (1 + N_)) * (1 + (N_ ** 2) / 4 + (N_ ** 4) / 64);
const B = [N_ / 2 - (2 / 3) * N_ ** 2 + (5 / 16) * N_ ** 3 + (41 / 180) * N_ ** 4, (13 / 48) * N_ ** 2 - (3 / 5) * N_ ** 3 + (557 / 1440) * N_ ** 4, (61 / 240) * N_ ** 3 - (103 / 140) * N_ ** 4, (49561 / 161280) * N_ ** 4];
const D = [N_ / 2 - (2 / 3) * N_ ** 2 + (37 / 96) * N_ ** 3 - (1 / 360) * N_ ** 4, (1 / 48) * N_ ** 2 + (1 / 15) * N_ ** 3 - (437 / 1440) * N_ ** 4, (17 / 480) * N_ ** 3 - (37 / 840) * N_ ** 4, (4397 / 161280) * N_ ** 4];
const rad = (d: number) => (d * Math.PI) / 180;

export function sweref99tmToWgs84(e: number, n: number): { lat: number; lon: number } {
  const xi = n / (K0 * AH), eta = (e - FE) / (K0 * AH);
  let xiP = xi, etaP = eta;
  for (let j = 1; j <= 4; j++) { xiP -= D[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); etaP -= D[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const phiStar = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  const dLon = Math.atan(Math.sinh(etaP) / Math.cos(xiP));
  const s = Math.sin(phiStar);
  const phi = phiStar + s * Math.cos(phiStar) * (E2 + E2 ** 2 + E2 ** 3 + E2 ** 4 - ((7 * E2 ** 2 + 17 * E2 ** 3 + 30 * E2 ** 4) / 6) * s ** 2 + ((224 * E2 ** 3 + 889 * E2 ** 4) / 120) * s ** 4 - (4279 * E2 ** 4 / 1260) * s ** 6);
  return { lat: (phi * 180) / Math.PI, lon: LON0 + (dLon * 180) / Math.PI };
}

export function wgs84ToSweref99tm(lat: number, lon: number): { e: number; n: number } {
  const phi = rad(lat), dl = rad(lon - LON0);
  const s = Math.sin(phi);
  const phiStar = phi - s * Math.cos(phi) * (E2 + ((5 * E2 ** 2 - E2 ** 3) / 6) * s ** 2 + ((104 * E2 ** 3 - 45 * E2 ** 4) / 120) * s ** 4 + (1237 * E2 ** 4 / 1260) * s ** 6);
  const xiP = Math.atan(Math.tan(phiStar) / Math.cos(dl));
  const etaP = Math.atanh(Math.cos(phiStar) * Math.sin(dl));
  let xi = xiP, eta = etaP;
  for (let j = 1; j <= 4; j++) { xi += B[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP); eta += B[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP); }
  return { e: FE + K0 * AH * eta, n: K0 * AH * xi };
}

// --- GeoPackage-geometri: GP-header + WKB ---
export interface GpkgLine { id: string; attrs: Record<string, unknown>; parts: { lat: number; lon: number }[][] }

function parseWkbLines(buf: Buffer, off: number, toLL: (x: number, y: number) => { lat: number; lon: number }): { lat: number; lon: number }[][] {
  const le = buf[off] === 1;
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o: number) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  const type = u32(off + 1);
  const base = type % 1000, dim = type >= 3000 ? 4 : type >= 2000 ? 3 : type >= 1000 ? 3 : 2;
  let p = off + 5;
  if (base === 2) {
    const n = u32(p); p += 4;
    const pts = [];
    for (let i = 0; i < n; i++) { pts.push(toLL(f64(p), f64(p + 8))); p += 8 * dim; }
    return [pts];
  }
  if (base === 5) {
    const n = u32(p); p += 4;
    const out = [];
    for (let i = 0; i < n; i++) {
      const sub = parseWkbLines(buf, p, toLL);
      out.push(...sub);
      const le2 = buf[p] === 1; const t2 = le2 ? buf.readUInt32LE(p + 1) : buf.readUInt32BE(p + 1);
      const d2 = t2 >= 1000 ? 3 : 2; const m = le2 ? buf.readUInt32LE(p + 5) : buf.readUInt32BE(p + 5);
      p += 9 + m * 8 * d2;
    }
    return out;
  }
  return [];
}

/** Läser ett linjeskikt ur en GeoPackage (EPSG:3006 antas om inget annat anges i gpkg_geometry_columns). */
export function readGpkgLines(path: string, layer: string, limit?: number): GpkgLine[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const g = db.prepare("SELECT column_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?").get(layer) as { column_name: string; srs_id: number } | undefined;
    if (!g) throw new Error(`Skiktet ${layer} saknas i ${path}`);
    const toLL = g.srs_id === 4326 ? (x: number, y: number) => ({ lat: y, lon: x }) : (x: number, y: number) => sweref99tmToWgs84(x, y);
    const rows = db.prepare(`SELECT rowid AS _rid, * FROM "${layer}"${limit ? ` LIMIT ${limit}` : ""}`).all() as Record<string, unknown>[];
    return rows.map((r) => {
      const blob = Buffer.from(r[g.column_name] as Uint8Array);
      const flags = blob[3], envKind = (flags >> 1) & 7;
      const envBytes = [0, 32, 48, 48, 64][envKind] ?? 0;
      const { [g.column_name]: _g, ...attrs } = r;
      void _g;
      return { id: String(r["objektidentitet"] ?? r["_rid"]), attrs, parts: parseWkbLines(blob, 8 + envBytes, toLL) };
    });
  } finally {
    db.close();
  }
}

const TYPE_MAP: Record<string, PathType> = { Gångstig: "path", Cykelväg: "cycleway", Parkväg: "footway", Elljusspår: "footway", Traktorväg: "track", Vandringsled: "path", "Småväg": "service", "Småväg enkel standard": "track", "Lokalgata liten": "residential", Kvartersväg: "service" };

/** Bygger ett stignät av Lantmäteriets linjeobjekt. Noder delas bara där koordinater sammanfaller (0,5 m), aldrig på avstånd. */
export function linesToGraph(lines: GpkgLine[], source = "lantmateriet"): SerializedGraph {
  const ways: RawWay[] = [];
  const key = (p: { lat: number; lon: number }) => { const s = wgs84ToSweref99tm(p.lat, p.lon); return `${Math.round(s.e * 2) / 2},${Math.round(s.n * 2) / 2}`; };
  for (const l of lines) {
    const type = TYPE_MAP[String(l.attrs["objekttyp"] ?? "")];
    if (!type) continue;
    l.parts.forEach((pts, i) => ways.push({ id: `${l.id}.${i}`, type, nodes: pts.map((p) => ({ id: key(p), lat: p.lat, lon: p.lon })) }));
  }
  return buildGraph(ways, source);
}
