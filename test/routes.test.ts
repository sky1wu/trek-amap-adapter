import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { wgs84ToGcj02 } from '../src/geo/gcj02.js';
import { biasCenter } from '../src/google/requests.js';
import type { GooglePlace } from '../src/google/types.js';
import { regionalCoordinates } from './coordinate-fixtures.js';
import {
  circle,
  defaultResponse,
  detailsMask,
  harness,
  jsonResponse,
  poi,
  rectangle,
  searchMask,
  tip,
} from './fixtures.js';

const apps: FastifyInstance[] = [];
function setup(...args: Parameters<typeof harness>) {
  const result = harness(...args);
  apps.push(result.app);
  return result;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('current TREK request contract', () => {
  it.each(regionalCoordinates)(
    '$name converts search/detail output and search/autocomplete bias',
    async ({ name, citycode, wgs84, gcj02 }) => {
      const location = `${gcj02.longitude},${gcj02.latitude}`;
      const { app, calls } = setup(async (url) => {
        if (url.pathname.endsWith('/regeo'))
          return jsonResponse({
            status: '1',
            infocode: '10000',
            regeocode: { addressComponent: { citycode } },
          });
        if (url.pathname.endsWith('/inputtips'))
          return jsonResponse({
            status: '1',
            infocode: '10000',
            tips: [{ ...tip, name, location }],
          });
        return jsonResponse({ status: '1', infocode: '10000', pois: [{ ...poi, name, location }] });
      });
      const locationBias = { circle: { center: wgs84, radius: 1000 } };
      const search = await app.inject({
        method: 'POST',
        url: '/v1/places:searchText',
        payload: { textQuery: name, locationBias },
      });
      expect(search.statusCode).toBe(200);
      const searched = search.json<{ places: GooglePlace[] }>().places[0];
      expect(searched?.location.longitude).toBeCloseTo(wgs84.longitude, 8);
      expect(searched?.location.latitude).toBeCloseTo(wgs84.latitude, 8);
      const autocomplete = await app.inject({
        method: 'POST',
        url: '/v1/places:autocomplete',
        payload: { input: name, locationBias },
      });
      expect(autocomplete.statusCode).toBe(200);
      const id = autocomplete.json<{ suggestions: { placePrediction: { placeId: string } }[] }>()
        .suggestions[0]?.placePrediction.placeId;
      expect(id).toBe(searched?.id);
      const details = await app.inject(`/v1/places/${id}`);
      expect(details.statusCode).toBe(200);
      expect(details.json<GooglePlace>().location).toEqual(searched?.location);
      const expectedLocation = `${gcj02.longitude.toFixed(6)},${gcj02.latitude.toFixed(6)}`;
      expect(calls[0]?.url.searchParams.get('location')).toBe(expectedLocation);
      expect(calls[1]?.url.searchParams.get('region')).toBe(citycode);
      expect(calls[2]?.url.searchParams.get('location')).toBe(expectedLocation);
      expect(calls[2]?.url.searchParams.get('city')).toBe(citycode);
      expect(calls[3]?.url.pathname).toBe('/v5/place/detail');
    },
  );

  it('searches with the actual field mask and WGS84 circle, retaining nationwide recall', async () => {
    const { app, calls } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/places:searchText',
      headers: { 'x-goog-api-key': 'trek-dummy', 'x-goog-fieldmask': searchMask },
      payload: { textQuery: '西安SKP', languageCode: 'zh-CN', locationBias: circle },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ places: GooglePlace[] }>().places[0]?.id).toBe('amap_B0TESTSKP1');
    expect(calls.map((c) => c.url.pathname)).toEqual(['/v3/geocode/regeo', '/v5/place/text']);
    const converted = wgs84ToGcj02(circle.circle.center);
    expect(calls[0]?.url.searchParams.get('location')).toBe(
      `${converted.longitude.toFixed(6)},${converted.latitude.toFixed(6)}`,
    );
    expect(calls[1]?.url.searchParams.get('region')).toBe('029');
    expect(calls[1]?.url.searchParams.get('city_limit')).toBe('false');
    expect(calls[1]?.url.searchParams.has('location')).toBe(false);
    expect(calls[1]?.url.searchParams.get('show_fields')).toBe('business');
    expect(calls[1]?.url.searchParams.get('page_size')).toBe('20');
    for (const call of calls) {
      expect(call.url.origin).toBe('https://restapi.amap.com');
      expect(call.url.searchParams.get('key')).toBe('server-amap-secret-for-tests');
      expect(call.init.redirect).toBe('error');
      expect(new Headers(call.init.headers).has('x-goog-api-key')).toBe(false);
    }
  });

  it('autocompletes, then resolves details with sessionToken and expanded fields', async () => {
    const { app, calls } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/places:autocomplete',
      payload: {
        input: '西安S',
        languageCode: 'zh-CN',
        sessionToken: 'session-1',
        locationBias: rectangle,
      },
    });
    expect(res.statusCode).toBe(200);
    const id = res.json<{ suggestions: { placePrediction: { placeId: string } }[] }>()
      .suggestions[0]?.placePrediction.placeId;
    expect(id).toBe('amap_B0TESTSKP1');
    expect(calls[1]?.url.searchParams.get('city')).toBe('029');
    expect(calls[1]?.url.searchParams.get('citylimit')).toBe('false');
    expect(calls[1]?.url.searchParams.get('datatype')).toBe('poi');
    expect(calls[1]?.url.searchParams.has('location')).toBe(true);
    const details = await app.inject({
      method: 'GET',
      url: `/v1/places/${id}?languageCode=zh-CN&sessionToken=session-1`,
      headers: { 'x-goog-fieldmask': `${detailsMask},reviews,editorialSummary` },
    });
    expect(details.statusCode).toBe(200);
    expect(details.json()).toMatchObject({ id, reviews: [], photos: [] });
    expect(calls[2]?.url.pathname).toBe('/v5/place/detail');
    expect(calls[2]?.url.searchParams.get('id')).toBe(poi.id);
    expect(calls.every((c) => !c.url.searchParams.has('sessionToken'))).toBe(true);
  });

  it.each([
    'photos',
    'editorialSummary',
    'reviews',
    'photos,reviews,editorialSummary',
    'photos.name',
  ])('answers %s even while upstream is unavailable', async (mask) => {
    const { app, calls } = setup(async () => {
      throw new Error('unavailable');
    });
    const res = await app.inject({
      url: '/v1/places/amap_B0TESTSKP1',
      headers: { 'x-goog-fieldmask': mask },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ photos: [], reviews: [] });
    expect(calls).toHaveLength(0);
    // Mirrors both TREK photo call sites: empty references never reach /media.
    const mediaRequests = res.json<{ photos: { name: string }[] }>().photos.map((p) => p.name);
    expect(mediaRequests).toHaveLength(0);
  });

  it('routes colon verbs exactly, rejecting arbitrary proxy/media paths', async () => {
    const { app, calls } = setup();
    for (const url of [
      '/v1/places:unknown',
      '/v1/placesXsearchText',
      '/proxy?url=http://127.0.0.1',
      '/v1/places/amap_B123/photos/a/media',
    ]) {
      const res = await app.inject({ method: 'POST', url, payload: { textQuery: 'test' } });
      expect(res.statusCode).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  it('resolves stable saved IDs after adapter restart', async () => {
    const first = setup();
    const result = await first.app.inject({
      method: 'POST',
      url: '/v1/places:searchText',
      payload: { textQuery: '西安SKP' },
    });
    const stored = JSON.parse(
      JSON.stringify(result.json<{ places: GooglePlace[] }>().places[0]),
    ) as GooglePlace;
    await first.app.close();
    const restarted = setup();
    const details = await restarted.app.inject(`/v1/places/${stored.id}`);
    expect(details.statusCode).toBe(200);
    expect(details.json<GooglePlace>().id).toBe(stored.id);
    expect(details.json<GooglePlace>().location).toEqual(stored.location);
  });
});

describe('bias, cache and language', () => {
  it('falls back to a normal search when optional city lookup fails', async () => {
    const { app, calls } = setup(async (url) =>
      url.pathname.endsWith('/regeo')
        ? jsonResponse({ status: '0', infocode: '20011' })
        : defaultResponse(url),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/places:searchText',
      payload: { textQuery: 'test', locationBias: circle },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[1]?.url.searchParams.has('region')).toBe(false);
  });

  it('caches by query, language, bias and ID; ignores session tokens', async () => {
    const { app, calls } = setup();
    const search = (languageCode: string, locationBias = circle, textQuery = '西安SKP') =>
      app.inject({
        method: 'POST',
        url: '/v1/places:searchText',
        payload: { textQuery, languageCode, locationBias },
      });
    await search('zh-CN');
    await search('zh-CN');
    expect(calls.filter((c) => c.url.pathname.endsWith('/text'))).toHaveLength(1);
    await search('en');
    await search('en', { circle: { center: { latitude: 39.9, longitude: 116.4 }, radius: 1000 } });
    await search('zh-CN', circle, '西安北站');
    expect(calls.filter((c) => c.url.pathname.endsWith('/text'))).toHaveLength(4);
    for (const sessionToken of ['one', 'two'])
      await app.inject({
        method: 'POST',
        url: '/v1/places:autocomplete',
        payload: { input: '西安', sessionToken },
      });
    expect(calls.filter((c) => c.url.pathname.endsWith('/inputtips'))).toHaveLength(1);
    await app.inject('/v1/places/amap_B0TESTSKP1?languageCode=en&sessionToken=one');
    await app.inject('/v1/places/amap_B0TESTSKP1?languageCode=en&sessionToken=two');
    await app.inject('/v1/places/amap_B0TESTSKP1?languageCode=zh-CN');
    await app.inject('/v1/places/amap_OTHER?languageCode=en');
    expect(calls.filter((c) => c.url.pathname.endsWith('/detail'))).toHaveLength(3);
  });

  it.each(['zh-CN', 'zh-TW', 'en', 'de', 'pt-BR'])(
    'accepts %s and defaults to Chinese upstream results',
    async (languageCode) => {
      const { app, calls } = setup();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/places:searchText',
            payload: { textQuery: '上海', languageCode },
          })
        ).statusCode,
      ).toBe(200);
      expect(calls[0]?.url.searchParams.has('langCode')).toBe(false);
    },
  );

  it('uses English only when explicitly enabled for an entitled key', async () => {
    const { app, calls } = setup(undefined, { AMAP_ENGLISH_ENABLED: 'true' });
    await app.inject('/v1/places/amap_B0TESTSKP1?languageCode=en-US');
    expect(calls[0]?.url.searchParams.get('langCode')).toBe('en');
  });

  it('search and details work when the key rejects every explicit langCode', async () => {
    const { app, calls } = setup(async (url) =>
      url.searchParams.has('langCode')
        ? jsonResponse({ status: '0', infocode: '10012' })
        : defaultResponse(url),
    );
    const search = await app.inject({
      method: 'POST',
      url: '/v1/places:searchText',
      payload: { textQuery: '西安SKP', languageCode: 'zh-CN' },
    });
    expect(search.statusCode).toBe(200);
    expect((await app.inject('/v1/places/amap_B0TESTSKP1?languageCode=en')).statusCode).toBe(200);
    expect(calls.every((call) => !call.url.searchParams.has('langCode'))).toBe(true);
  });

  it('handles dateline rectangles without biasing to Greenwich', () => {
    expect(
      biasCenter({
        rectangle: {
          low: { latitude: -10, longitude: 170 },
          high: { latitude: 10, longitude: -170 },
        },
      }),
    ).toEqual({ latitude: 0, longitude: 180 });
  });
});

describe('input/output validation', () => {
  it.each([
    {},
    { textQuery: '' },
    { textQuery: 'x'.repeat(81) },
    { textQuery: 'test', upstream: 'https://evil.example' },
    {
      textQuery: 'test',
      locationBias: { circle: { center: { latitude: 91, longitude: 10 }, radius: 10 } },
    },
    {
      textQuery: 'test',
      locationBias: { circle: { center: { latitude: 30, longitude: 110 }, radius: -1 } },
    },
    {
      textQuery: 'test',
      locationBias: {
        rectangle: {
          low: { latitude: 40, longitude: 110 },
          high: { latitude: 30, longitude: 120 },
        },
      },
    },
    { textQuery: 'test', languageCode: 'en&key=evil' },
    { textQuery: 'a\u0000b' },
  ])('rejects invalid bodies %j without an upstream request', async (payload) => {
    const { app, calls } = setup();
    expect(
      (await app.inject({ method: 'POST', url: '/v1/places:searchText', payload })).statusCode,
    ).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each([
    'amap:B123',
    'google-id',
    'amap_B123%3Fkey=evil',
    'amap_B123%23hash',
    'amap_B123%2Fpath',
    'amap_B123%7Cx',
    'amap_B123~p1',
  ])('rejects unsafe detail ID %s', async (id) => {
    const { app, calls } = setup();
    expect((await app.inject(`/v1/places/${id}`)).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects invalid JSON, large bodies, extra queries and excessive masks', async () => {
    const { app, calls } = setup();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/places:searchText',
          headers: { 'content-type': 'application/json' },
          payload: '{',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/places:searchText',
          payload: { textQuery: 'x'.repeat(17000) },
        })
      ).statusCode,
    ).toBe(413);
    expect((await app.inject('/v1/places/amap_B123?url=https://evil.example')).statusCode).toBe(
      400,
    );
    expect(
      (
        await app.inject({
          url: '/v1/places/amap_B123',
          headers: { 'x-goog-fieldmask': 'x'.repeat(2049) },
        })
      ).statusCode,
    ).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('keeps relevant order, drops invalid/duplicate POIs and does not fabricate missing details', async () => {
    const { app } = setup(async () =>
      jsonResponse({
        status: '1',
        infocode: '10000',
        pois: [null, { ...poi, id: 'FIRST' }, poi, poi, { ...poi, location: '' }],
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/places:searchText',
      payload: { textQuery: '西安' },
    });
    expect(res.json<{ places: GooglePlace[] }>().places.map((p) => p.id)).toEqual([
      'amap_FIRST',
      'amap_B0TESTSKP1',
    ]);
    expect((await app.inject('/v1/places/amap_MISSING')).statusCode).toBe(404);
  });

  it('returns empty results and only resolvable autocomplete tips', async () => {
    const { app } = setup(async (url) =>
      jsonResponse(
        url.pathname.endsWith('/text')
          ? { status: '1', pois: [] }
          : { status: '1', tips: [{ ...tip, id: [] }, tip, tip] },
      ),
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/places:searchText',
          payload: { textQuery: 'empty' },
        })
      ).json(),
    ).toEqual({ places: [] });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/places:autocomplete',
          payload: { input: '西安' },
        })
      ).json<{ suggestions: unknown[] }>().suggestions,
    ).toHaveLength(1);
  });

  it('optionally authenticates adapter clients while keeping health public', async () => {
    const { app, calls } = setup(undefined, { ADAPTER_TOKEN: 'adapter-client-secret' });
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/v1/places/amap_B0TESTSKP1')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/v1/places/amap_B0TESTSKP1',
          headers: { 'x-goog-api-key': 'wrong' },
        })
      ).statusCode,
    ).toBe(401);
    expect(calls).toHaveLength(0);
    expect(
      (
        await app.inject({
          url: '/v1/places/amap_B0TESTSKP1',
          headers: { 'x-goog-api-key': 'adapter-client-secret' },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls[0]?.url.searchParams.get('key')).toBe('server-amap-secret-for-tests');
  });
});
