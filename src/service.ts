import type { FastifyRequest } from 'fastify';
import type { AmapClient } from './amap/client.js';
import { mapAmapPoiToGooglePlace, mapAmapTipToGoogleSuggestion } from './amap/mapper.js';
import { stringValue } from './amap/types.js';
import { TtlCache } from './cache.js';
import type { Config } from './config.js';
import { ApiError } from './errors.js';
import { wgs84ToGcj02 } from './geo/gcj02.js';
import {
  biasCenter,
  type AutocompleteRequest,
  type LocationBias,
  type TextSearchRequest,
} from './google/requests.js';
import { decodePlaceId } from './google/id.js';
import type { GooglePlace, GoogleSuggestion } from './google/types.js';

export class PlacesService {
  private readonly searches: TtlCache<{ places: GooglePlace[] }>;
  private readonly suggestions: TtlCache<{ suggestions: GoogleSuggestion[] }>;
  private readonly detailsCache: TtlCache<GooglePlace>;
  private readonly regions: TtlCache<string>;

  constructor(
    private readonly config: Config,
    private readonly client: AmapClient,
  ) {
    this.searches = new TtlCache(config.CACHE_MAX_ENTRIES);
    this.suggestions = new TtlCache(config.CACHE_MAX_ENTRIES);
    this.detailsCache = new TtlCache(config.CACHE_MAX_ENTRIES);
    this.regions = new TtlCache(config.CACHE_MAX_ENTRIES);
  }

  private language(language: string): string {
    return this.config.AMAP_ENGLISH_ENABLED === 'true' && /^en(?:-|$)/i.test(language)
      ? 'en'
      : 'zh';
  }

  private async biasParameters(bias: LocationBias | undefined, request: FastifyRequest) {
    const center = biasCenter(bias);
    if (!center) return {};
    const converted = wgs84ToGcj02(center);
    const location = `${converted.longitude.toFixed(6)},${converted.latitude.toFixed(6)}`;
    const key = `${converted.longitude.toFixed(3)},${converted.latitude.toFixed(3)}`;
    const cached = this.regions.get(key);
    if (cached !== undefined) return { location, city: cached || undefined };
    try {
      const data = await this.client.region(location);
      const component = data.regeocode.addressComponent;
      const code = stringValue(component.citycode);
      const adcode = stringValue(component.adcode);
      const city =
        code && /^\d{2,4}$/.test(code)
          ? code
          : adcode && /^(11|12|31|50|81|82)\d{4}$/.test(adcode)
            ? `${adcode.slice(0, 2)}0000`
            : undefined;
      this.regions.set(key, city ?? '', 24 * 60 * 60 * 1000);
      return { location, city };
    } catch (error) {
      request.log.warn(
        {
          requestId: request.id,
          upstream: 'amap',
          route: 'biasRegion',
          status: error instanceof ApiError ? error.statusCode : 502,
          infocode: error instanceof ApiError ? error.infocode : undefined,
        },
        'Bias city lookup failed; using keyword search',
      );
      // A short negative TTL limits repeated optional failures while typing.
      this.regions.set(key, '', 5000);
      return { location };
    }
  }

  async search(input: TextSearchRequest, request: FastifyRequest) {
    const key = JSON.stringify(input);
    const cached = this.searches.get(key);
    if (cached) {
      request.cacheHit = true;
      return cached;
    }
    const bias = await this.biasParameters(input.locationBias, request);
    const data = await this.client.search({
      keywords: input.textQuery,
      show_fields: 'business',
      page_size: String(input.pageSize),
      langCode: this.language(input.languageCode),
      city_limit: 'false',
      ...(bias.city ? { region: bias.city } : {}),
    });
    const seen = new Set<string>();
    const places = data.pois
      .map(mapAmapPoiToGooglePlace)
      .filter((p): p is GooglePlace => {
        if (!p || seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .slice(0, input.pageSize);
    const result = { places };
    this.searches.set(key, result, 2 * 60 * 1000);
    return result;
  }

  async autocomplete(input: AutocompleteRequest, request: FastifyRequest) {
    // Session tokens are billing-only and must not fragment result caches.
    const key = JSON.stringify({
      input: input.input,
      languageCode: input.languageCode,
      locationBias: input.locationBias,
    });
    const cached = this.suggestions.get(key);
    if (cached) {
      request.cacheHit = true;
      return cached;
    }
    const bias = await this.biasParameters(input.locationBias, request);
    const data = await this.client.autocomplete({
      keywords: input.input,
      datatype: 'poi',
      citylimit: 'false',
      ...(bias.city && bias.location ? { city: bias.city, location: bias.location } : {}),
    });
    const seen = new Set<string>();
    const suggestions = data.tips
      .map(mapAmapTipToGoogleSuggestion)
      .filter((p): p is GoogleSuggestion => {
        if (!p || seen.has(p.placePrediction.placeId)) return false;
        seen.add(p.placePrediction.placeId);
        return true;
      })
      .slice(0, 5);
    const result = { suggestions };
    this.suggestions.set(key, result, 45 * 1000);
    return result;
  }

  async details(id: string, language: string, request: FastifyRequest) {
    const rawId = decodePlaceId(id);
    const key = JSON.stringify([id, language]);
    const cached = this.detailsCache.get(key);
    if (cached) {
      request.cacheHit = true;
      return cached;
    }
    const data = await this.client.details({
      id: rawId,
      show_fields: 'business',
      langCode: this.language(language),
    });
    const place = data.pois.map(mapAmapPoiToGooglePlace).find((p) => p?.id === id);
    if (!place) throw new ApiError(404, 'AMap place not found');
    this.detailsCache.set(key, place, 6 * 60 * 60 * 1000);
    return place;
  }
}
