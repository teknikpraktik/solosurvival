#!/usr/bin/env python3
"""Bygger geografiska stigtiler för klienten ur ett regionalt OSM-PBF-extrakt (Etapp 3A).

Användning: python3 -I experiments/data/build_tiles.py <extrakt.osm.pbf> <utkatalog> [--bbox S,W,N,E] [--source URL] [--md5 HEX]

Pipeline: regionalt extrakt -> stigrelevanta ways (hela ways, originalattribut i vitlista) -> rutnät med
0,05° x 0,1° tiles (ca 5,6 x 5,6 km vid Värmland) -> deltakodad JSON per tile + manifest.

Designval:
- Aktivitetsfiltret körs i klienten (src/geo/osm/overpass.ts decideWay), så samma tiles tjänar Walk/Run/MTB och
  tillgångsregler kan skärpas utan ny datagenerering.
- Varje way lagras hel i varje tile den berör (även segment som korsar en tile utan nod i den). Klienten
  deduplicerar på way-id. Tile-gränser klipper därför aldrig en stig.
- Farliga passager: noder där en stig delar nod-id med större väg (<= tertiary), järnväg eller å/älv/bäck
  lagras per way som index-lista "h". Saknad förbindelse (korsning utan delad nod) blir aldrig en hazard-nod
  eftersom grafen inte heller förbinder ways utan delad nod.
- Koordinater i mikrograder (heltal), deltakodade. Ingen personlig data; endast OSM (ODbL).
"""
import gzip, hashlib, json, math, os, sys, time

LAT_STEP_U = 50_000    # 0,05°
LON_STEP_U = 100_000   # 0,10°
TILE_FORMAT = 1

PATH_HIGHWAYS = {"path", "footway", "track", "cycleway", "service", "residential", "living_street", "unclassified", "pedestrian", "bridleway"}
MAJOR_HIGHWAYS = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
RAILWAYS = {"rail", "light_rail", "tram", "subway", "narrow_gauge", "preserved", "funicular", "monorail"}
WATERWAYS = {"river", "stream", "canal"}
KEEP_TAGS = ("highway", "access", "foot", "bicycle", "mtb:scale", "oneway", "oneway:bicycle", "service", "area", "indoor",
             "bridge", "tunnel", "ford", "sac_scale", "trail_visibility", "surface", "tracktype", "motor_vehicle", "maxspeed",
             "railway", "lit", "segregated")


# Hindrets typ (ett tecken per hazardindex, fält "k" i tilen). Klienten kopplar bara passager över "t" (v2.2): gång över secondary/tertiary är en vanlig övergång,
# medan motorväg/trunk/primary ("T"), järnväg ("r") och vattendrag ("w") förblir hinder. Äldre tiles saknar "k" och tolkas med en strukturregel.
TERTIARY_LIKE = {"secondary", "tertiary", "secondary_link", "tertiary_link"}
SEVERITY = {"T": 3, "r": 2, "w": 1, "t": 0}


def hazard_kind(tags):
    """Tecken för ett hinder-way: 't' secondary/tertiary(+länk), 'T' övriga större vägar, 'r' järnväg, 'w' vattendrag."""
    hw = tags.get("highway")
    if tags.get("railway") in RAILWAYS:
        return "r"
    if tags.get("waterway") in WATERWAYS:
        return "w"
    return "t" if hw in TERTIARY_LIKE else "T"


def worst(a, b):
    """Den allvarligaste av två hindertyper (en nod kan delas av flera hinder)."""
    return a if SEVERITY[a] >= SEVERITY[b] else b


def tiles_of(pts):
    """Alla tiles som en polyline berör. Långa segment samplas var ~150 m så att inga tiles hoppas över."""
    out = set()
    for i, (la, lo) in enumerate(pts):
        out.add((la // LAT_STEP_U, lo // LON_STEP_U))
        if i:
            pla, plo = pts[i - 1]
            dla, dlo = la - pla, lo - plo
            steps = int(max(abs(dla) / 1350, abs(dlo) / 2700))  # 1350 µ° lat ~ 150 m, 2700 µ° lon ~ 150 m vid 60°N
            for s in range(1, steps):
                f = s / steps
                out.add(((pla + dla * f) // LAT_STEP_U, (plo + dlo * f) // LON_STEP_U))
    return {(int(a), int(b)) for a, b in out}


def delta(vals):
    return [vals[0]] + [vals[i] - vals[i - 1] for i in range(1, len(vals))]


def main(pbf, outdir, bbox=None, source="", md5=""):
    import osmium  # sent import så att hazard_kind kan enhetstestas utan osmium
    t0 = time.time()
    hazard = {}
    paths = []
    n_all = 0
    fp = osmium.FileProcessor(pbf).with_locations()
    for o in fp:
        if not o.is_way():
            continue
        tags = {t.k: t.v for t in o.tags}
        hw, rw, ww = tags.get("highway"), tags.get("railway"), tags.get("waterway")
        is_hazard = hw in MAJOR_HIGHWAYS or rw in RAILWAYS or ww in WATERWAYS
        is_path = hw in PATH_HIGHWAYS
        if not (is_hazard or is_path):
            continue
        n_all += 1
        try:
            nodes = [(n.ref, round(n.lat * 1e6), round(n.lon * 1e6)) for n in o.nodes]
        except osmium.InvalidLocationError:
            continue
        if is_hazard and not is_path:
            kind = hazard_kind(tags)
            for nid, _, _ in nodes:
                hazard[nid] = worst(hazard[nid], kind) if nid in hazard else kind
            continue
        if len(nodes) < 2:
            continue
        paths.append((o.id, {k: tags[k] for k in KEEP_TAGS if k in tags}, nodes))
    print(f"pass 1: {len(paths)} stig-ways, {len(hazard)} hazardnoder, {time.time() - t0:.1f} s", file=sys.stderr)

    if bbox:
        s, w, n, e = (round(float(v) * 1e6) for v in bbox.split(","))
    else:
        s = w = 10 ** 12; n = e = -10 ** 12
    buckets = {}
    for wid, tags, nodes in paths:
        pts = [(la, lo) for _, la, lo in nodes]
        if bbox and not any(s <= la <= n and w <= lo <= e for la, lo in pts):
            continue
        rec = {"i": wid, "t": tags,
               "n": delta([x[0] for x in nodes]), "y": delta([x[1] for x in nodes]), "x": delta([x[2] for x in nodes])}
        h = [i for i, x in enumerate(nodes) if x[0] in hazard]
        if h:
            rec["h"] = h
            rec["k"] = "".join(hazard[nodes[i][0]] for i in h)
        for key in tiles_of(pts):
            buckets.setdefault(key, []).append(rec)
            s, w, n, e = (min(s, key[0] * LAT_STEP_U), min(w, key[1] * LON_STEP_U), max(n, (key[0] + 1) * LAT_STEP_U), max(e, (key[1] + 1) * LON_STEP_U)) if not bbox else (s, w, n, e)

    tdir = os.path.join(outdir, "t")
    os.makedirs(tdir, exist_ok=True)
    for f in os.listdir(tdir):
        os.remove(os.path.join(tdir, f))
    entries, total, raw_total, gz_total = [], 0, 0, 0
    for (ty, tx), ways in sorted(buckets.items()):
        ways.sort(key=lambda r: r["i"])
        body = json.dumps({"f": TILE_FORMAT, "ty": ty, "tx": tx, "w": ways}, separators=(",", ":"), ensure_ascii=False).encode()
        name = f"{ty}_{tx}.json"
        open(os.path.join(tdir, name), "wb").write(body)
        gz = len(gzip.compress(body, 9))
        entries.append([ty, tx, len(ways), len(body), gz])
        total += 1; raw_total += len(body); gz_total += gz
    # Innehållshash identifierar datauppsättningen; klienten använder den som cache-nyckel (ingen stale data).
    h = hashlib.sha256()
    for ty, tx, *_ in entries:
        h.update(open(os.path.join(tdir, f"{ty}_{tx}.json"), "rb").read())
    manifest = {
        "format": TILE_FORMAT, "region": "varmland", "dataVersion": h.hexdigest()[:12],
        "tile": {"latStepDeg": LAT_STEP_U / 1e6, "lonStepDeg": LON_STEP_U / 1e6, "coordUnitDeg": 1e-6},
        "bbox": [s / 1e6, w / 1e6, n / 1e6, e / 1e6], "bboxOrder": "south,west,north,east",
        "tilesFields": ["ty", "tx", "ways", "bytes", "gzipBytes"], "tiles": entries,
        "stats": {"tiles": total, "pathWays": len(paths), "hazardNodes": len(hazard), "bytes": raw_total, "gzipBytes": gz_total},
        "source": {"extract": os.path.basename(pbf), "url": source, "md5": md5,
                   "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        "keptTags": list(KEEP_TAGS),
        "license": "ODbL 1.0 – © OpenStreetMap contributors",
    }
    json.dump(manifest, open(os.path.join(outdir, "manifest.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"{total} tiles, {raw_total / 1e6:.1f} MB rå, {gz_total / 1e6:.1f} MB gzip, {time.time() - t0:.1f} s", file=sys.stderr)


if __name__ == "__main__":
    a = sys.argv[1:]
    opts = {}
    pos = []
    i = 0
    while i < len(a):
        if a[i].startswith("--"):
            opts[a[i][2:]] = a[i + 1]; i += 2
        else:
            pos.append(a[i]); i += 1
    main(pos[0], pos[1], opts.get("bbox"), opts.get("source", ""), opts.get("md5", ""))
