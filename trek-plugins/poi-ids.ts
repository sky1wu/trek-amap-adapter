import type { Place, PluginContext, RouteRequest } from 'trek-plugin-sdk';
import { decodePlaceId } from '../src/google/id.js';
import type { RouteRequest as AdapterRouteRequest } from '../src/routing/requests.js';

/** Resolve only within the acting user's trip. No proximity/name guessing. */
export async function attachPoiIds(
  request: RouteRequest,
  parsed: AdapterRouteRequest,
  ctx: PluginContext,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const places = await Promise.race([
      ctx.trips.getPlaces(request.tripId),
      new Promise<Place[]>((resolve) => {
        timer = setTimeout(() => resolve([]), 800);
      }),
    ]);
    // Current TREK sends coordinates only. A numeric placeId from other callers
    // identifies a TREK database row, never an upstream AMap POI.
    for (let i = 0; i < parsed.waypoints.length; i++) {
      const point = parsed.waypoints[i]!;
      const placeId = request.waypoints[i]?.placeId;
      const matches = places.filter(
        (place) =>
          (placeId === undefined || place.id === placeId) &&
          place.lat === point.lat &&
          place.lng === point.lng,
      );
      if (matches.length !== 1) continue;
      const id = matches[0]!.google_place_id;
      if (typeof id !== 'string') continue;
      try {
        point.amapId = decodePlaceId(id);
      } catch {
        /* Non-AMap or malformed ID: coordinates suffice. */
      }
    }
  } catch {
    /* Missing grants, inaccessible trip or failed RPC: coordinate-only routing. */
  } finally {
    clearTimeout(timer);
  }
}
