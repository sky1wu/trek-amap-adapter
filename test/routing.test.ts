import { afterEach, describe, expect, it } from 'vitest';
import { harness, jsonResponse, defaultResponse } from './fixtures.js';
import { regionalCoordinates } from './coordinate-fixtures.js';
import { mapRoutePlan } from '../src/routing/mapper.js';
import type { RouteResult } from '../src/routing/requests.js';

// Synthetic shapes based on AMap v5 documentation and the observed response layout.
const points = [
  { lat: 34.25, lng: 108.95 },
  { lat: 34.26, lng: 108.96 },
  { lat: 34.27, lng: 108.97 },
];
const polyline = '108.955,34.248;108.957,34.249;108.959,34.25';
const plan = { distance: '1234', cost: { duration: '600' }, steps: [{ polyline }] };
const envelope = (paths: unknown[] = [plan]) =>
  jsonResponse({ status: '1', infocode: '10000', route: { paths } });
const apps: ReturnType<typeof harness>['app'][] = [];
function setup(...args: Parameters<typeof harness>) {
  const result = harness(...args);
  apps.push(result.app);
  return result;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const request = (profile = 'driving', waypoints = points.slice(0, 2)) => ({
  method: 'POST' as const,
  url: '/v1/routes',
  payload: { profile, waypoints },
});

describe('AMap routing contract', () => {
  it.each([
    ['driving', 'driving'],
    ['walking', 'walking'],
    ['cycling', 'bicycling'],
  ])('maps %s to v5 and returns WGS-84', async (profile, endpoint) => {
    const { app, calls } = setup(async () => envelope());
    const response = await app.inject(request(profile));
    expect(response.statusCode).toBe(200);
    const { route } = response.json<{ route: RouteResult }>();
    expect(route.legs).toEqual([{ distance: 1234, duration: 600 }]);
    expect(route.coordinates).toHaveLength(3);
    expect(route.coordinates[0]![0]).toBeCloseTo(34.249558, 4);
    expect(route.coordinates[0]![1]).not.toBe(108.955);
    const url = calls[0]!.url;
    expect(url.pathname).toBe(`/v5/direction/${endpoint}`);
    expect(url.searchParams.get('show_fields')).toBe('cost,polyline');
    expect(url.searchParams.get('origin')).not.toBe('108.950000,34.250000');
    expect(url.searchParams.get('origin')).toMatch(/^\d+\.\d{6},\d+\.\d{6}$/);
    expect(url.searchParams.get('key')).toBe('server-amap-secret-for-tests');
    expect(calls[0]!.init.redirect).toBe('error');
  });
  it.each(regionalCoordinates)('converts every route point in $name', async ({ wgs84, gcj02 }) => {
    const poly = `${gcj02.longitude},${gcj02.latitude};${gcj02.longitude + 0.001},${gcj02.latitude + 0.001}`;
    const { app, calls } = setup(async () => envelope([{ ...plan, steps: [{ polyline: poly }] }]));
    const response = await app.inject(
      request('walking', [
        { lat: wgs84.latitude, lng: wgs84.longitude },
        { lat: wgs84.latitude + 0.001, lng: wgs84.longitude + 0.001 },
      ]),
    );
    const first = response.json<{ route: RouteResult }>().route.coordinates[0]!;
    expect(first[0]).toBeCloseTo(wgs84.latitude, 7);
    expect(first[1]).toBeCloseTo(wgs84.longitude, 7);
    expect(calls[0]!.url.searchParams.get('origin')).toBe(
      `${gcj02.longitude.toFixed(6)},${gcj02.latitude.toFixed(6)}`,
    );
  });
  it('keeps overseas coordinates unchanged', async () => {
    const { app, calls } = setup(async () =>
      envelope([{ ...plan, steps: [{ polyline: '139.76,35.68;139.77,35.69' }] }]),
    );
    const response = await app.inject(
      request('driving', [
        { lat: 35.68, lng: 139.76 },
        { lat: 35.69, lng: 139.77 },
      ]),
    );
    expect(response.json<{ route: RouteResult }>().route.coordinates).toEqual([
      [35.68, 139.76],
      [35.69, 139.77],
    ]);
    expect(calls[0]!.url.searchParams.get('origin')).toBe('139.760000,35.680000');
  });
  it('preserves waypoint leg order despite out-of-order upstream completion', async () => {
    let count = 0;
    const { app } = setup(async () => {
      const index = count++;
      if (index === 0) await new Promise((resolve) => setTimeout(resolve, 15));
      return envelope([
        {
          ...plan,
          distance: String(index + 1),
          steps: [{ polyline: index === 0 ? '0,0;1,1' : '1,1;2,2' }],
        },
      ]);
    });
    const response = await app.inject(request('walking', points));
    expect(response.json<{ route: RouteResult }>().route).toEqual({
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      distance: 3,
      duration: 1200,
      legs: [
        { distance: 1, duration: 600 },
        { distance: 2, duration: 600 },
      ],
    });
  });
  it('caches by mode and ordered leg, with no upstream call on a repeated request', async () => {
    const { app, calls } = setup(async () => envelope());
    await app.inject(request());
    await app.inject(request());
    expect(calls).toHaveLength(1);
    await app.inject(request('walking'));
    await app.inject(request('driving', [points[1]!, points[0]!]));
    expect(calls).toHaveLength(3);
  });
  it('does not cache errors', async () => {
    const { app, calls } = setup(async () => jsonResponse({ status: '0', infocode: '10003' }));
    expect((await app.inject(request())).statusCode).toBe(429);
    await app.inject(request());
    expect(calls).toHaveLength(2);
  });
  it.each(['20800', '20801', '20802', '20803'])(
    'returns no route for coverage code %s',
    async (infocode) => {
      const { app } = setup(async () => jsonResponse({ status: '0', infocode }));
      const response = await app.inject(request());
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ route: null });
    },
  );
  it('returns no route when upstream finds no plan', async () => {
    const { app } = setup(async () => envelope([]));
    expect((await app.inject(request())).json()).toEqual({ route: null });
  });
  it('fails the whole route if any leg is unavailable', async () => {
    let count = 0;
    const { app } = setup(async () => (count++ ? envelope([]) : envelope()));
    expect((await app.inject(request('driving', points))).json()).toEqual({ route: null });
  });
  it('rejects malformed upstream metrics', async () => {
    const { app } = setup(async () => envelope([{ ...plan, distance: '' }]));
    expect((await app.inject(request())).statusCode).toBe(502);
  });
  it('authenticates routes with the existing adapter token', async () => {
    const token = 'local-test-adapter-token';
    const { app, calls } = setup(async () => envelope(), { ADAPTER_TOKEN: token });
    expect((await app.inject(request())).statusCode).toBe(401);
    expect(calls).toHaveLength(0);
    expect(
      (await app.inject({ ...request(), headers: { 'x-goog-api-key': token } })).statusCode,
    ).toBe(200);
    expect(calls[0]!.url.toString()).not.toContain(token);
  });
  it.each([
    { profile: 'flight', waypoints: points },
    { profile: 'walking', waypoints: [] },
    { profile: 'walking', waypoints: [points[0]] },
    { profile: 'driving', waypoints: Array(31).fill(points[0]) },
    { profile: 'walking', waypoints: [{ lat: 91, lng: 0 }, points[0]] },
    { profile: 'walking', waypoints: [{ lat: '34', lng: 0 }, points[0]] },
    { profile: 'walking', waypoints: [{ lat: 34, lng: 181 }, points[0]] },
    { profile: 'driving', waypoints: points, url: 'https://example.com' },
    { profile: 'driving', waypoints: points, departureTime: 'tomorrow' },
  ])('rejects invalid requests before upstream work: %j', async (payload) => {
    const { app, calls } = setup();
    expect((await app.inject({ method: 'POST', url: '/v1/routes', payload })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('aborts slow upstream work and releases concurrency', async () => {
    let aborted = false;
    const { app } = setup(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('sensitive URL'));
            },
            { once: true },
          );
        }),
      { AMAP_TIMEOUT_MS: '50', AMAP_MAX_CONCURRENT: '1' },
    );
    const response = await app.inject(request());
    expect(response.statusCode).toBe(504);
    expect(aborted).toBe(true);
    expect(response.body).not.toContain('sensitive');
    expect((await app.inject(request())).statusCode).toBe(504);
  });
});

describe('transit routes', () => {
  const transit = {
    distance: '2500',
    cost: { duration: '1800' },
    segments: [
      {
        walking: { distance: '10', steps: [{ polyline: { polyline: '0,0;1,1' } }] },
        bus: {
          buslines: [
            { name: '地铁2号线', polyline: { polyline: '1,1;2,2' } },
            { name: 'alternative', polyline: { polyline: '99,9;100,10' } },
          ],
        },
      },
      { walking: { distance: '5', steps: [{ polyline: { polyline: '2,2;3,3' } }] } },
    ],
  };
  it('resolves city codes and preserves walking / bus / last-mile geometry', async () => {
    const { app, calls } = setup(async (url) =>
      url.pathname.includes('regeo')
        ? defaultResponse(url)
        : jsonResponse({ status: '1', route: { transits: [transit] } }),
    );
    const response = await app.inject(request('transit'));
    expect(response.statusCode).toBe(200);
    const route = response.json<{ route: RouteResult }>().route;
    expect(route.coordinates).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(route.legs).toEqual([{ distance: 2500, duration: 1800, note: '地铁2号线' }]);
    const upstream = calls.find((call) => call.url.pathname.includes('direction'))!.url;
    expect(upstream.pathname).toBe('/v5/direction/transit/integrated');
    expect(upstream.searchParams.get('city1')).toBe('029');
    expect(upstream.searchParams.get('city2')).toBe('029');
  });
  it('does not invent city codes or silently switch to driving', async () => {
    const { app, calls } = setup(async () =>
      jsonResponse({
        status: '1',
        regeocode: { addressComponent: { citycode: [], adcode: '610100' } },
      }),
    );
    expect((await app.inject(request('transit'))).json()).toEqual({ route: null });
    expect(calls.every((c) => c.url.pathname.includes('regeo'))).toBe(true);
  });
  it('keeps the recommended cross-city plan when AMap appends an empty segment', async () => {
    let region = 0;
    const { app, calls } = setup(async (url) =>
      url.pathname.includes('regeo')
        ? jsonResponse({
            status: '1',
            regeocode: { addressComponent: { citycode: region++ === 0 ? '0755' : '1852' } },
          })
        : jsonResponse({
            status: '1',
            route: {
              transits: [
                { ...transit, segments: [...transit.segments, {}] },
                { ...transit, distance: '9000' },
              ],
            },
          }),
    );
    const response = await app.inject(request('transit'));
    expect(response.statusCode).toBe(200);
    const route = response.json<{ route: RouteResult }>().route;
    expect(route).toEqual({
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      distance: 2500,
      duration: 1800,
      legs: [{ distance: 2500, duration: 1800, note: '地铁2号线' }],
    });
    const upstream = calls.find((call) => call.url.pathname.includes('direction'))!.url;
    expect(upstream.searchParams.get('city1')).toBe('0755');
    expect(upstream.searchParams.get('city2')).toBe('1852');
  });
  it('ignores empty placeholders without changing transit geometry, metrics or line names', () => {
    expect(
      mapRoutePlan(
        { ...transit, segments: [{}, transit.segments[0], {}, transit.segments[1], {}] },
        true,
      ),
    ).toEqual(mapRoutePlan(transit, true));
  });
  it('does not accept a transit plan made only of empty placeholders', () => {
    expect(mapRoutePlan({ ...transit, segments: [{}, {}] }, true)).toBeNull();
  });
  it.each([
    null,
    [],
    '',
    { unsupported: {} },
    { walking: { distance: '10' } },
    { bus: { buslines: [{ name: 'Missing track', distance: '1000' }] } },
  ])('still rejects invalid or incomplete populated segments: %j', (segment) => {
    expect(mapRoutePlan({ ...transit, segments: [...transit.segments, segment] }, true)).toBeNull();
  });
  it('uses the next complete plan when a railway has no track geometry', async () => {
    const missing = {
      ...transit,
      segments: [
        {
          railway: {
            distance: '1000',
            departure_stop: { location: '0,0' },
            arrival_stop: { location: '1,1' },
          },
        },
      ],
    };
    const { app } = setup(async (url) =>
      url.pathname.includes('regeo')
        ? defaultResponse(url)
        : jsonResponse({ status: '1', route: { transits: [missing, transit] } }),
    );
    expect(
      (await app.inject(request('transit'))).json<{ route: RouteResult }>().route.coordinates,
    ).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
});

describe('polyline and metric integrity', () => {
  it('accepts bicycling duration at root', () => {
    expect(
      mapRoutePlan({ distance: '1', duration: '2', steps: [{ polyline: '0,0;1,1' }] }, false)
        ?.duration,
    ).toBe(2);
  });
  it.each(['180.1,0;1,1', '0,91;1,1', 'NaN,0;1,1', '0,0;broken'])(
    'rejects invalid vertices: %s',
    (polyline) => {
      expect(() => mapRoutePlan({ ...plan, steps: [{ polyline }] }, false)).toThrow(
        'Invalid AMap route coordinate',
      );
    },
  );
  it('rejects missing positive-distance geometry', () => {
    expect(mapRoutePlan({ ...plan, steps: [{ step_distance: '100' }] }, false)).toBeNull();
  });
  it('deduplicates only adjacent vertices', () => {
    expect(
      mapRoutePlan({ ...plan, steps: [{ polyline: '0,0;1,1;1,1;0,0' }] }, false)?.coordinates,
    ).toEqual([
      [0, 0],
      [1, 1],
      [0, 0],
    ]);
  });
  it('refuses routes above TREK vertex budget', () => {
    const polyline = Array.from({ length: 10_001 }, (_, i) => `${i / 1000},0`).join(';');
    expect(mapRoutePlan({ ...plan, steps: [{ polyline }] }, false)).toBeNull();
  });
});
