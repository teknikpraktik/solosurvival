export interface LatLon {
  lat: number;
  lon: number;
}

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Lokal plan approximation (meter) kring en origo – tillräckligt exakt för spelområden. */
export function toLocal(origin: LatLon, p: LatLon): { x: number; y: number } {
  return {
    x: rad(p.lon - origin.lon) * R * Math.cos(rad(origin.lat)),
    y: rad(p.lat - origin.lat) * R,
  };
}

export function fromLocal(origin: LatLon, p: { x: number; y: number }): LatLon {
  return {
    lat: origin.lat + (p.y / R) * (180 / Math.PI),
    lon: origin.lon + (p.x / (R * Math.cos(rad(origin.lat)))) * (180 / Math.PI),
  };
}

export function bearingDeg(a: LatLon, b: LatLon): number {
  const { x, y } = toLocal(a, b);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

export function isValidLatLon(p: LatLon): boolean {
  return (
    Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
  );
}

export function cumulativeLengths(pts: LatLon[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineM(pts[i - 1], pts[i]));
  return cum;
}

export function pointAlong(pts: LatLon[], cum: number[], distM: number): LatLon {
  const total = cum[cum.length - 1];
  const d = Math.max(0, Math.min(total, distM));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const segLen = cum[i] - cum[i - 1];
  const t = segLen === 0 ? 0 : (d - cum[i - 1]) / segLen;
  return {
    lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t,
    lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * t,
  };
}

export interface Projection {
  distAlongM: number;
  distanceM: number;
  point: LatLon;
}

/** Närmaste punkt på en polylinje. */
export function projectToPolyline(pts: LatLon[], cum: number[], p: LatLon): Projection {
  let best: Projection = { distAlongM: 0, distanceM: Infinity, point: pts[0] };
  for (let i = 1; i < pts.length; i++) {
    const a = toLocal(p, pts[i - 1]);
    const b = toLocal(p, pts[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    // p är origo i det lokala systemet.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-a.x * dx - a.y * dy) / len2));
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    const dist = Math.hypot(qx, qy);
    if (dist < best.distanceM) {
      best = {
        distAlongM: cum[i - 1] + (cum[i] - cum[i - 1]) * t,
        distanceM: dist,
        point: fromLocal(p, { x: qx, y: qy }),
      };
    }
  }
  return best;
}

/** Ray-casting; polygon som [lon, lat]-ring. */
export function pointInPolygon(p: LatLon, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Sant om polygonen (ring, utan upprepad slutpunkt) korsar sig själv. */
export function polygonSelfIntersects(ring: [number, number][]): boolean {
  const n = ring.length;
  const ccw = (a: number[], b: number[], c: number[]) =>
    (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
  const cross = (a: number[], b: number[], c: number[], d: number[]) =>
    ccw(a, c, d) * ccw(b, c, d) < 0 && ccw(a, b, c) * ccw(a, b, d) < 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) === 1 || (i === 0 && j === n - 1)) continue;
      if (cross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function polygonAreaKm2(ring: [number, number][]): number {
  const o = { lat: ring[0][1], lon: ring[0][0] };
  const pts = ring.map(([lon, lat]) => toLocal(o, { lat, lon }));
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2 / 1e6;
}
