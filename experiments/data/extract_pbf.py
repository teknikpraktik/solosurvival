#!/usr/bin/env python3
"""Plockar ut stigrelevanta ways för de tre testområdena ur ett regionalt OSM-PBF-extrakt (t.ex. länsextrakt).

Användning: python3 experiments/data/extract_pbf.py <extrakt.osm.pbf> <utkatalog> [källa-url] [md5]
Utdata per område: <område>.pbf.json.gz i samma Overpass-liknande format som fixtures-osm-api
(way.nodes + way.geometry + tags), så att samma importkod kan användas. Ways med minst en nod i rutan tas med.
"""
import gzip, json, os, sys, time
import osmium

AREAS = {
    "skutberget": (59.3588, 13.368, 59.3858, 13.42),
    "i2-skogen": (59.3965, 13.44, 59.4235, 13.492),
    "sormon": (59.365, 13.328, 59.392, 13.38),
}
KEYS = ("highway", "railway", "waterway", "barrier")

def main(pbf, outdir, source="", md5=""):
    os.makedirs(outdir, exist_ok=True)
    t0 = time.time()
    out = {k: [] for k in AREAS}
    fp = osmium.FileProcessor(pbf).with_locations()
    nways = 0
    for o in fp:
        if not o.is_way():
            continue
        tags = {t.k: t.v for t in o.tags}
        if not any(k in tags for k in KEYS):
            continue
        nways += 1
        try:
            pts = [(n.lat, n.lon) for n in o.nodes]
        except osmium.InvalidLocationError:
            continue
        for name, (s, w, n, e) in AREAS.items():
            if any(s <= la <= n and w <= lo <= e for la, lo in pts):
                out[name].append({
                    "type": "way", "id": o.id, "nodes": [n_.ref for n_ in o.nodes],
                    "geometry": [{"lat": la, "lon": lo} for la, lo in pts], "tags": tags,
                    "version": o.version, "timestamp": o.timestamp.isoformat() if o.timestamp else None,
                })
    for name, ways in out.items():
        payload = json.dumps({"source": "regional PBF extract", "elements": ways})
        with gzip.open(os.path.join(outdir, f"{name}.pbf.json.gz"), "wt", encoding="utf8") as f:
            f.write(payload)
        meta = {"area": name, "bbox": AREAS[name], "bboxOrder": "south,west,north,east", "ways": len(ways),
                "extract": os.path.basename(pbf), "extractUrl": source, "extractMd5": md5,
                "extractedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "wallSeconds": round(time.time() - t0, 1),
                "keptTags": list(KEYS), "license": "ODbL 1.0 – © OpenStreetMap contributors"}
        json.dump(meta, open(os.path.join(outdir, f"{name}.meta.json"), "w"), indent=2, ensure_ascii=False)
        print(name, len(ways), "ways")
    print(f"{nways} relevanta ways i extraktet, {time.time() - t0:.1f} s")

if __name__ == "__main__":
    main(*sys.argv[1:])
