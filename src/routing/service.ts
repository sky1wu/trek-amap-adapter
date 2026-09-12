import type { AmapClient } from '../amap/client.js';
import { TtlCache } from '../cache.js';
import type { Config } from '../config.js';
import { ApiError } from '../errors.js';
import { wgs84ToGcj02 } from '../geo/gcj02.js';
import { appendPoints, mapRoutePlan, type MappedLeg } from './mapper.js';
import type { RouteRequest, RouteResult } from './requests.js';

export class RoutingService {
  private readonly legs: TtlCache<MappedLeg>;
  private readonly cities: TtlCache<string>;
  constructor(
    private readonly config: Config,
    private readonly client: AmapClient,
  ) {
    // Route geometries are much larger than POIs; bound cache independently.
    this.legs = new TtlCache(Math.min(config.CACHE_MAX_ENTRIES, 100));
    this.cities = new TtlCache(config.CACHE_MAX_ENTRIES);
  }

  private async city(location: string, signal: AbortSignal): Promise<string | null> {
    const cached = this.cities.get(location);
    if (cached) return cached;
    const result = await this.client.region(location, signal);
    const code = result.regeocode.addressComponent.citycode;
    if (typeof code !== 'string' || !/^\d{2,5}$/.test(code)) return null;
    this.cities.set(location, code, 86_400_000);
    return code;
  }

  async route(
    request: RouteRequest,
    context: { cacheHit: boolean },
  ): Promise<{ route: RouteResult | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 17_000);
    const signal = controller.signal;
    const locations = request.waypoints.map((point) => {
      const gcj = wgs84ToGcj02({ latitude: point.lat, longitude: point.lng });
      return `${gcj.longitude.toFixed(6)},${gcj.latitude.toFixed(6)}`;
    });
    const resolvedCities = new Map<string, Promise<string | null>>();
    const city = (location: string) => {
      let pending = resolvedCities.get(location);
      if (!pending) {
        pending = this.city(location, signal);
        resolvedCities.set(location, pending);
      }
      return pending;
    };
    const results: Array<MappedLeg | null> = new Array(locations.length - 1).fill(null);
    let next = 0;
    let cacheHits = 0;
    const worker = async () => {
      while (next < results.length) {
        if (signal.aborted) throw new ApiError(504, 'AMap upstream timeout');
        const index = next++;
        const origin = locations[index]!;
        const destination = locations[index + 1]!;
        const key = JSON.stringify([request.profile, origin, destination]);
        const cached = this.legs.get(key);
        if (cached) {
          results[index] = cached;
          cacheHits++;
          continue;
        }
        const parameters: Record<string, string> = {
          origin,
          destination,
          show_fields: 'cost,polyline',
        };
        if (request.profile === 'transit') {
          const city1 = await city(origin);
          const city2 = await city(destination);
          if (!city1 || !city2) continue;
          Object.assign(parameters, { city1, city2, strategy: '0', AlternativeRoute: '5' });
        } else if (request.profile === 'driving') parameters.strategy = '32';
        else parameters.alternative_route = '1';
        try {
          const response = await this.client.directions(request.profile, parameters, signal);
          const candidates =
            request.profile === 'transit' ? response.route.transits : response.route.paths;
          if (!candidates) throw new ApiError(502, 'Invalid AMap route response');
          for (const candidate of candidates) {
            const result = mapRoutePlan(candidate, request.profile === 'transit');
            if (result) {
              results[index] = result;
              this.legs.set(
                key,
                result,
                request.profile === 'walking' || request.profile === 'cycling' ? 300_000 : 60_000,
              );
              break;
            }
          }
        } catch (error) {
          if (
            error instanceof ApiError &&
            ['20800', '20801', '20802', '20803'].includes(error.infocode ?? '')
          )
            continue;
          throw error;
        }
      }
    };
    try {
      // Bounded parallel legs keep long days inside TREK's 20-second hook budget.
      await Promise.all(
        Array.from(
          { length: Math.min(3, this.config.AMAP_MAX_CONCURRENT, results.length) },
          worker,
        ),
      );
      context.cacheHit = cacheHits === results.length;
      if (results.some((leg) => leg === null)) return { route: null };
      const route: RouteResult = { coordinates: [], distance: 0, duration: 0, legs: [] };
      for (const result of results) {
        if (!result) return { route: null };
        appendPoints(route.coordinates, result.coordinates);
        if (route.coordinates.length > 10_000) return { route: null };
        route.distance += result.distance;
        route.duration += result.duration;
        route.legs.push({
          distance: result.distance,
          duration: result.duration,
          ...(result.note ? { note: result.note } : {}),
        });
      }
      return { route };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
