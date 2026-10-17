/** Testområden i Karlstadstrakten. Bboxarna är [söder, väster, norr, öster] (Overpass-ordning), ca 3 × 3 km. */
export interface AreaDef {
  id: "skutberget" | "i2-skogen" | "sormon";
  name: string;
  bbox: [number, number, number, number];
  note: string;
}

export const AREAS: AreaDef[] = [
  {
    id: "skutberget",
    name: "Skutberget",
    bbox: [59.3588, 13.368, 59.3858, 13.42],
    note: "Centrerad på Nominatim-träffen Skutberget (59.3723, 13.3937).",
  },
  {
    id: "i2-skogen",
    name: "I2-skogen",
    bbox: [59.3965, 13.44, 59.4235, 13.492],
    note: "Nominatim har flera träffar för 'I2-skogen' (59.402/13.460, 59.416/13.473, 59.395/13.475). Rutan täcker de två första; avgränsningen är vår, inte en officiell gräns.",
  },
  {
    id: "sormon",
    name: "Sörmon",
    bbox: [59.365, 13.328, 59.392, 13.38],
    note: "Centrerad på Sörmons naturreservat (59.3786, 13.3539). Rutan överlappar Skutberget något i väst/öst.",
  },
];
