import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { haversineM } from "@/geo/geometry";
import { indexGraph } from "@/geo/graph/graph";
import { linesToGraph, readGpkgLines, sweref99tmToWgs84, wgs84ToSweref99tm } from "./lib/gpkg";

describe("SWEREF 99 TM", () => {
  it("centralmeridianen ger E = 500 000 och N ≈ meridianbåge", () => {
    const { e, n } = wgs84ToSweref99tm(59, 15);
    expect(e).toBeCloseTo(500000, 3);
    expect(Math.abs(n - 6540067)).toBeLessThan(150);
  });
  it("går att räkna fram och tillbaka med millimeterprecision", () => {
    for (const [lat, lon] of [[59.38, 13.5], [59.4, 13.46], [67.8, 20.2], [55.6, 13.0]]) {
      const s = wgs84ToSweref99tm(lat, lon);
      const b = sweref99tmToWgs84(s.e, s.n);
      expect(haversineM({ lat, lon }, b)).toBeLessThan(0.001);
    }
  });
  it("Karlstad ligger på rimliga SWEREF-koordinater (E ≈ 4,0·10⁵, N ≈ 6,59·10⁶)", () => {
    const s = wgs84ToSweref99tm(59.38, 13.5);
    expect(s.e).toBeGreaterThan(390000); expect(s.e).toBeLessThan(430000);
    expect(s.n).toBeGreaterThan(6580000); expect(s.n).toBeLessThan(6600000);
  });
});

/** SYNTETISK GeoPackage byggd i testet (inte Lantmäteridata): verifierar att läsaren tolkar header, WKB och attribut. */
function writeGpkg(file: string, lines: { id: string; typ: string; pts: [number, number][] }[]) {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT, geometry_type_name TEXT, srs_id INT, z TINYINT, m TINYINT)");
  db.exec("CREATE TABLE ovrig_vag (fid INTEGER PRIMARY KEY, objektidentitet TEXT, objekttyp TEXT, geom BLOB)");
  db.prepare("INSERT INTO gpkg_geometry_columns VALUES ('ovrig_vag','geom','LINESTRING',3006,0,0)").run();
  for (const l of lines) {
    const wkb = Buffer.alloc(9 + l.pts.length * 16);
    wkb[0] = 1; wkb.writeUInt32LE(2, 1); wkb.writeUInt32LE(l.pts.length, 5);
    l.pts.forEach(([x, y], i) => { wkb.writeDoubleLE(x, 9 + i * 16); wkb.writeDoubleLE(y, 17 + i * 16); });
    const hdr = Buffer.from([0x47, 0x50, 0, 1, 0xbe, 0x0b, 0, 0]); // magic, version 0, flags (little-endian, ingen envelope), srs 3006
    db.prepare("INSERT INTO ovrig_vag (objektidentitet, objekttyp, geom) VALUES (?,?,?)").run(l.id, l.typ, Buffer.concat([hdr, wkb]));
  }
  db.close();
}

describe("GeoPackage-läsare (syntetisk fil)", () => {
  it("läser linjer, attribut och bygger en graf med delade noder bara vid sammanfallande koordinater", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gpkg-"));
    try {
      const f = path.join(dir, "t.gpkg");
      const o = wgs84ToSweref99tm(59.38, 13.5);
      const p = (dx: number, dy: number): [number, number] => [o.e + dx, o.n + dy];
      writeGpkg(f, [
        { id: "a", typ: "Gångstig", pts: [p(0, 0), p(100, 0)] },
        { id: "b", typ: "Gångstig", pts: [p(100, 0), p(100, 100)] },          // delar slutpunkt med a
        { id: "c", typ: "Cykelväg", pts: [p(50, -50), p(50, 50)] },            // korsar a utan delad nod (bro/falsk korsning)
        { id: "d", typ: "Järnväg", pts: [p(0, 10), p(100, 10)] },              // ska hoppas över
      ]);
      const lines = readGpkgLines(f, "ovrig_vag");
      expect(lines).toHaveLength(4);
      expect(lines[0].attrs.objekttyp).toBe("Gångstig");
      expect(haversineM(lines[0].parts[0][0], { lat: 59.38, lon: 13.5 })).toBeLessThan(0.01);
      const g = indexGraph(linesToGraph(lines));
      expect(g.edges.size).toBe(3);
      expect(g.components.length).toBe(2); // a+b hänger ihop, c är separat (ingen falsk koppling)
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
