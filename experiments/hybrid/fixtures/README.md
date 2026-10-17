# Geografiska testfixturer (Karlstadstrakten)

Verkliga OpenStreetMap-data för tre ca 3 × 3 km stora testområden, sparade som återanvändbara fixturer för hybrid-AI-studien.

| Område | Bbox (söder, väster, norr, öster) | Noder / ways / relationer (rått) | Hämtad (UTC) |
|---|---|---|---|
| Skutberget | 59.3588, 13.368, 59.3858, 13.42 | 6 089 / 624 / 39 | 2026-10-17 06:44 |
| I2-skogen | 59.3965, 13.44, 59.4235, 13.492 | 19 265 / 2 461 / 77 | 2026-10-17 06:44 |
| Sörmon | 59.365, 13.328, 59.392, 13.38 | 5 002 / 372 / 30 | 2026-10-17 06:44 |

Avgränsningen är vår egen (centrerad på Nominatim-träffar), inte officiella gränser. För I2-skogen finns flera träffar i Nominatim; rutan täcker de två första.

## Filer

- `<område>.osm.json.gz` – ways och multipolygon-relationer i Overpass-liknande format (`way.nodes` + `way.geometry`, `relation.members[].geometry`), filtrerade på taggarna `highway, railway, natural, landuse, waterway, building, barrier, leisure`.
- `<område>.meta.json` – källa, tidpunkt, antal element, begränsningar.
- `<område>.elevation.json` – 30 × 30 höjdpunkter (EU-DEM 25 m via opentopodata.org), hämtade 2026-10-17 07:13 UTC.

## Källa och licens

- **OpenStreetMap-data** © OpenStreetMap-bidragsgivare, [ODbL 1.0](https://www.openstreetmap.org/copyright). Hämtade via det officiella OSM-API:t (`/api/0.6/map`, i 2 × 2 tiles per område) och `/api/0.6/relation/<id>/full` för att komplettera relationer. Attribution krävs vid publicering av kartor eller härledda data. Härledda databaser (t.ex. hybridgrafer) omfattas av ODbL:s share-alike-regler (kontrollera detta före produktion).
- **Höjdprover**: Copernicus EU-DEM v1.1 (fri och öppen åtkomst) via opentopodata.org.
- Overpass-API:er försöktes först men var blockerade, trasiga (HTTP 500) eller regionala (`overpass.osm.ch` täcker bara Schweiz) när data hämtades. Inga data har hittats på: allt i fixturerna kommer från ovan nämnda anrop.

## Kända begränsningar

1. `/map` returnerar ways med minst en nod i rutan. Deras noder utanför rutan ingår, så ways kan sticka ut över kanten. Rutan klipps inte exakt.
2. Multipolygon-relationer som bara delvis ligger i rutan var ofullständiga. De flesta kompletterades med `/full`. **Vänern** (relation 1239458, 4 141 medlemmar) kunde inte hämtas komplett och hanteras i `lib/raster.ts` genom att kedjan av medlemmar i rutan sluts mot rutans kant, med vattensida vald där sidan nästan saknar vägnoder. Det är en heuristik som kontrollerats mot data (se rapporten), inte en geometri från OSM. Relationer som fortfarande är ofullständiga: Skutberget 1, Sörmon 1 (Vänern).
3. Tillträde, marktäcke och stigstatus i OSM är bidragsgivares bedömningar och kan vara föråldrade eller saknas. Förekomst av en stig i OSM är ingen garanti för att den är framkomlig eller får användas.
4. Höjddatan är punktprover med ~100 m mellan punkterna. Lokala branter under den skalan syns inte.
5. Datat är en ögonblicksbild. Kör om hämtningen för att uppdatera: `node experiments/hybrid/fetch-osm.mjs --force && node experiments/hybrid/complete-relations.mjs`.

## Återskapa

```bash
node experiments/hybrid/fetch-osm.mjs                 # ways/relationer via OSM-API (hoppar över cachade)
node experiments/hybrid/complete-relations.mjs        # kompletterar ofullständiga relationer
node experiments/hybrid/fetch-elevation.mjs           # höjdprover
npx tsx experiments/hybrid/profile-terrain.ts         # marktäckeprofil per område
```
