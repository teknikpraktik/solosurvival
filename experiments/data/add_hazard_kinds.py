#!/usr/bin/env python3
"""Lägger till hindertypen ("k") i befintliga stigtiles utan att ändra något annat i dem.

Användning: python3 -I experiments/data/add_hazard_kinds.py <tiles-katalog> <nybyggd-katalog> --source URL --md5 HEX

Bakgrund: tilesen i public/data/v1/varmland byggdes 2026-10-17, före v2.2, och saknar därför "k". Klienten använder då
strukturregeln för alla hinder, så att gångvägar som delar nod med motorväg/trunk/primary, järnväg eller vattendrag kopplas
som passager i spelnätet (src/data/region-graph.ts). Indatat från 2026-10-17 (md5 4419a79e…) finns inte längre hos källan,
och en full ombyggnad med ett nyare extrakt byter också ut vägdata som inte har med hindertypen att göra.

Det här skriptet tar hindertypen per OSM-nod från en ny körning av build_tiles.py (<nybyggd-katalog>, byggd ur ett nyare extrakt)
och skriver "k" på de vägar i de befintliga tilesen där varje hindernod ("h") har en typ i den nya körningen. Allt annat
(vägar, taggar, koordinater, "h") är bit för bit oförändrat. En väg där någon hindernod saknar typ får inget "k" och tolkas som förut.
Manifestets dataVersion, storlekar och källa uppdateras på samma sätt som build_tiles.py gör.
"""
import gzip, hashlib, json, os, sys, time


def undelta(d):
    out, acc = [], 0
    for v in d:
        acc += v
        out.append(acc)
    return out


def dump(tile):
    """Samma serialisering som build_tiles.py."""
    return json.dumps(tile, separators=(",", ":"), ensure_ascii=False).encode()


def kinds_by_node(built_dir):
    kind = {}
    for f in os.listdir(os.path.join(built_dir, "t")):
        for w in json.load(open(os.path.join(built_dir, "t", f)))["w"]:
            if "h" not in w or "k" not in w:
                continue
            ids = undelta(w["n"])
            for i, k in zip(w["h"], w["k"]):
                kind[ids[i]] = k
    return kind


def main(tiles_dir, built_dir, source, md5):
    kind = kinds_by_node(built_dir)
    man_path = os.path.join(tiles_dir, "manifest.json")
    manifest = json.load(open(man_path))
    tdir = os.path.join(tiles_dir, "t")
    stats = {"ways_with_h": 0, "with_k": 0, "without_k": 0, "unchanged_bytes_check": 0}
    entries = []
    for ty, tx, nways, _, _ in manifest["tiles"]:
        p = os.path.join(tdir, f"{ty}_{tx}.json")
        raw = open(p, "rb").read()
        tile = json.loads(raw)
        if dump(tile) != raw:
            sys.exit(f"{p}: serialiseringen skiljer sig från build_tiles.py, avbryter")
        stats["unchanged_bytes_check"] += 1
        for w in tile["w"]:
            if "h" not in w:
                continue
            stats["ways_with_h"] += 1
            if "k" in w:
                continue
            ids = undelta(w["n"])
            ks = [kind.get(ids[i]) for i in w["h"]]
            if all(ks):
                w["k"] = "".join(ks)
                stats["with_k"] += 1
            else:
                stats["without_k"] += 1
        body = dump(tile)
        open(p, "wb").write(body)
        entries.append([ty, tx, nways, len(body), len(gzip.compress(body, 9))])
    h = hashlib.sha256()
    for ty, tx, *_ in entries:
        h.update(open(os.path.join(tdir, f"{ty}_{tx}.json"), "rb").read())
    manifest["dataVersion"] = h.hexdigest()[:12]
    manifest["tiles"] = entries
    manifest["stats"]["bytes"] = sum(e[3] for e in entries)
    manifest["stats"]["gzipBytes"] = sum(e[4] for e in entries)
    manifest["hazardKinds"] = {"url": source, "md5": md5, "addedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                               "waysWithKinds": stats["with_k"], "waysWithoutKinds": stats["without_k"]}
    json.dump(manifest, open(man_path, "w"), separators=(",", ":"), ensure_ascii=False)
    print(json.dumps(stats), file=sys.stderr)


if __name__ == "__main__":
    a = sys.argv[1:]
    opts, pos, i = {}, [], 0
    while i < len(a):
        if a[i].startswith("--"):
            opts[a[i][2:]] = a[i + 1]; i += 2
        else:
            pos.append(a[i]); i += 1
    main(pos[0], pos[1], opts.get("source", ""), opts.get("md5", ""))
