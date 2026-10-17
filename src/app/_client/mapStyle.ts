import type { StyleSpecification } from "maplibre-gl";

/**
 * Diskret mörk bakgrundskarta från OpenFreeMap (OpenMapTiles-schema, data från OpenStreetMap).
 * - Gratis, ingen nyckel, ingen egen kartserver. Villkor: https://openfreemap.org/tos/ (vanlig webbläsaranvändning är tillåten;
 *   automatisk massnedladdning är inte det, så appen och service workern förhandshämtar eller cachar ALDRIG kartrutor – bara webbläsarens vanliga HTTP-cache).
 * - Attribution (OpenFreeMap, OpenMapTiles, OpenStreetMap) visas alltid i kartvyn, se MAP_ATTRIBUTION.
 * - Bara fyllnads- och linjelager, inga etiketter ⇒ inga typsnitt/sprites att hämta, lätt att rita på mobil.
 * - Större vägar och järnväg är varmt färgade (varning), stigar/skogsvägar dämpade; spelets egna lager ritas ovanpå.
 */
export const MAP_ATTRIBUTION = { text: "© OpenStreetMap · OpenFreeMap © OpenMapTiles", href: "https://www.openstreetmap.org/copyright" };

const MAJOR = ["motorway", "trunk", "primary", "secondary", "tertiary"];
const w = (...stops: (number | number[])[]) => ["interpolate", ["exponential", 1.4], ["zoom"], ...stops.flat()] as unknown as number;

export const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    omt: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors" },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0b0f14" } },
    { id: "grass", type: "fill", source: "omt", "source-layer": "landcover", filter: ["in", "class", "grass", "farmland"], paint: { "fill-color": "#101c18" } },
    { id: "wood", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", "class", "wood"], paint: { "fill-color": "#122a1f" } },
    { id: "wetland", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", "class", "wetland"], paint: { "fill-color": "#13262a" } },
    { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": "#112519", "fill-opacity": 0.6 } },
    { id: "residential", type: "fill", source: "omt", "source-layer": "landuse", filter: ["in", "class", "residential", "commercial", "industrial"], paint: { "fill-color": "#141a22" } },
    { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": "#0f2b45" } },
    { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": "#123a5c", "line-width": w(8, 0.6, 16, 3) } },
    { id: "path", type: "line", source: "omt", "source-layer": "transportation", minzoom: 12, filter: ["in", "class", "path", "track"], paint: { "line-color": "#2c3b30", "line-width": w(12, 0.5, 18, 2.5), "line-dasharray": [2, 1.5] } },
    { id: "minor", type: "line", source: "omt", "source-layer": "transportation", filter: ["in", "class", "minor", "service"], paint: { "line-color": "#2a3544", "line-width": w(11, 0.5, 18, 5) } },
    { id: "railway", type: "line", source: "omt", "source-layer": "transportation", filter: ["==", "class", "rail"], paint: { "line-color": "#6b5426", "line-width": w(10, 0.8, 18, 3), "line-dasharray": [3, 2] } },
    { id: "major", type: "line", source: "omt", "source-layer": "transportation", filter: ["in", "class", ...MAJOR], paint: { "line-color": "#7a4338", "line-width": w(6, 0.8, 12, 2, 18, 9) } },
  ],
};
