import geometry from './mainland.json' with { type: 'json' };
import { isValidCoordinate, type Coordinate } from './types.js';

type Ring = readonly (readonly number[])[];

function inRing(point: Coordinate, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
    if (
      ay > point.latitude !== by > point.latitude &&
      point.longitude < ((bx - ax) * (point.latitude - ay)) / (by - ay) + ax
    )
      inside = !inside;
  }
  return inside;
}

// Each island gets its own bounding box, avoiding a scan of every coastline vertex.
const polygons = geometry.coordinates.map((rings) => {
  const points = rings[0] ?? [];
  const xs = points.map((p) => p[0] ?? 0);
  const ys = points.map((p) => p[1] ?? 0);
  return {
    rings,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
});

/** Operational mainland mask including Hainan, excluding Hong Kong, Macao and Taiwan.
 * Natural Earth is approximate near coastlines/borders; see coordinate-validation.md.
 */
export function isInsideChina(point: Coordinate): boolean {
  if (!isValidCoordinate(point)) return false;
  return polygons.some(({ rings, minX, maxX, minY, maxY }) => {
    if (
      point.longitude < minX ||
      point.longitude > maxX ||
      point.latitude < minY ||
      point.latitude > maxY
    )
      return false;
    const outer = rings[0];
    return Boolean(
      outer && inRing(point, outer) && !rings.slice(1).some((ring) => inRing(point, ring)),
    );
  });
}
