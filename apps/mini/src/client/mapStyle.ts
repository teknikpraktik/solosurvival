import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { MAP_STYLE } from "@/app/_client/mapStyle";

/**
 * Samma bakgrundskarta som OUTBREAK (samma källa, lager och villkor, se src/app/_client/mapStyle.ts), men i en färgglad skymningspalett:
 * tillräckligt mörk för att spelets egna linjer och markörer ska synas som i vuxenappen, men lekfull i stället för dyster.
 * Större vägar och järnväg är fortfarande tydligt varmt färgade.
 */
const COLORS: Record<string, Record<string, string>> = {
  bg: { "background-color": "#2e2f63" },
  grass: { "fill-color": "#2f5a55" },
  wood: { "fill-color": "#2d6a52" },
  wetland: { "fill-color": "#2f5c70" },
  park: { "fill-color": "#337650" },
  residential: { "fill-color": "#3b3d75" },
  water: { "fill-color": "#3d7ed8" },
  waterway: { "line-color": "#4f95e6" },
  path: { "line-color": "#b9a7ff" },
  minor: { "line-color": "#6d71bd" },
  railway: { "line-color": "#e3a6ff" },
  major: { "line-color": "#ff8a65" },
};

export const MINI_MAP_STYLE: StyleSpecification = {
  ...MAP_STYLE,
  layers: MAP_STYLE.layers.map((l) => (COLORS[l.id] ? ({ ...l, paint: { ...(l as { paint?: object }).paint, ...COLORS[l.id] } } as LayerSpecification) : l)),
};
