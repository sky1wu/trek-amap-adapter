import { z } from 'zod';
import { ApiError } from '../errors.js';
import { parseLocation } from '../amap/mapper.js';
import { gcj02ToWgs84 } from '../geo/gcj02.js';
import type { RouteLeg, RoutePoint } from './requests.js';

export const routeEnvelopeSchema = z.object({
  route: z.object({
    paths: z.array(z.unknown()).max(20).optional(),
    transits: z.array(z.unknown()).max(20).optional(),
  }),
});
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)))
    return;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}
function hasContent(value: unknown): boolean {
  return Object.keys(record(value)).length > 0;
}
export function appendPoints(target: RoutePoint[], points: RoutePoint[]) {
  for (const point of points) {
    const last = target.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) target.push(point);
  }
}

// Both plain strings and v5 transit's {polyline: string} occur in real responses.
function decodePolyline(raw: unknown): RoutePoint[] | null {
  const value = typeof raw === 'string' ? raw : record(raw).polyline;
  if (typeof value !== 'string' || !value) return null;
  const result: RoutePoint[] = [];
  for (const pair of value.split(';')) {
    const coordinate = parseLocation(pair);
    if (!coordinate) throw new ApiError(502, 'Invalid AMap route coordinate');
    const converted = gcj02ToWgs84(coordinate);
    appendPoints(result, [[converted.latitude, converted.longitude]]);
    if (result.length > 10_000) return null;
  }
  return result;
}

export interface MappedLeg extends RouteLeg {
  coordinates: RoutePoint[];
}
export function mapRoutePlan(raw: unknown, transit: boolean): MappedLeg | null {
  const plan = record(raw);
  const distance = numeric(plan.distance);
  // Bicycling v5 returns duration at the path root; other modes use cost.duration.
  const duration = numeric(record(plan.cost).duration) ?? numeric(plan.duration);
  if (distance === undefined || duration === undefined)
    throw new ApiError(502, 'Invalid AMap route distance or duration');
  const coordinates: RoutePoint[] = [];
  const names: string[] = [];
  const add = (part: RecordValue) => {
    const points = decodePolyline(part.polyline);
    if (!points) return numeric(part.distance ?? part.step_distance) === 0;
    appendPoints(coordinates, points);
    return coordinates.length <= 10_000;
  };
  if (transit) {
    const segments = list(plan.segments);
    if (!segments.length) return null;
    for (const rawSegment of segments) {
      if (!rawSegment || typeof rawSegment !== 'object' || Array.isArray(rawSegment)) return null;
      const segment = record(rawSegment);
      // AMap can append {} after a complete transit journey (e.g. Futian to Kowloon Tong).
      // Only skip an empty object; populated segments still require real geometry.
      if (!Object.keys(segment).length) continue;
      const walking = record(segment.walking);
      const steps = list(walking.steps);
      if (hasContent(walking) && !steps.length && numeric(walking.distance) !== 0) return null;
      for (const step of steps) if (!add(record(step))) return null;
      const buslines = list(record(segment.bus).buslines);
      if (hasContent(segment.bus) && !buslines.length) return null;
      // buslines are alternatives for this segment, not consecutive journeys.
      if (buslines.length) {
        const line = record(buslines[0]);
        if (!add(line)) return null;
        if (typeof line.name === 'string') names.push(line.name);
      }
      // Rail/taxi may omit actual track geometry. Never invent straight segments.
      for (const key of ['railway', 'taxi']) {
        if (hasContent(segment[key]) && !add(record(segment[key]))) return null;
      }
      if (
        !steps.length &&
        !buslines.length &&
        !hasContent(segment.railway) &&
        !hasContent(segment.taxi)
      )
        return null;
    }
  } else {
    const steps = list(plan.steps);
    if (!steps.length) return null;
    for (const step of steps) if (!add(record(step))) return null;
  }
  if (coordinates.length < 2) return null;
  const note = [...new Set(names)]
    .join(' → ')
    .split('')
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .slice(0, 120);
  return { coordinates, distance, duration, ...(note ? { note } : {}) };
}
