/** Punkt `distM` meter från p i riktningen bearing (grader, 0 = norr). */
export function destPoint(p, distM, bearing) {
  const b = (bearing * Math.PI) / 180;
  const dLat = (Math.cos(b) * distM) / 111320;
  const dLon = (Math.sin(b) * distM) / (111320 * Math.cos((p.latitude * Math.PI) / 180));
  return { latitude: p.latitude + dLat, longitude: p.longitude + dLon };
}
