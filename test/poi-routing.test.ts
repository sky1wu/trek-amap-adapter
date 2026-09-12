import { afterEach, expect, it } from 'vitest';
import { createMockHost } from 'trek-plugin-sdk';
import { attachPoiIds } from '../trek-plugins/poi-ids.js';
import { routeRequestSchema } from '../src/routing/requests.js';
import { harness, jsonResponse, defaultResponse } from './fixtures.js';

const points = [
  { lat: 34.25, lng: 108.95 },
  { lat: 34.26, lng: 108.96 },
];
const request = { tripId: 7, dayId: null, profile: 'walking', waypoints: points };
const place = { id: 17, trip_id: 7, ...points[0], google_place_id: 'amap_B0FFIV1KBY' };
function host(places: unknown[], members = [1]) {
  return createMockHost({
    actingUserId: 1,
    grants: ['db:read:trips'],
    trips: { 7: { members, places } },
  });
}
it('reads the original AMap ID from a unique coordinate match in the current trip', async () => {
  const parsed = routeRequestSchema.parse(requestBody());
  await attachPoiIds(request, parsed, host([place]).ctx);
  expect(parsed.waypoints[0]!.amapId).toBe('B0FFIV1KBY');
  expect(parsed.waypoints[1]!.amapId).toBeUndefined();
});
function requestBody() {
  return { profile: request.profile, waypoints: points };
}
it('uses an explicit TREK numeric ID only to select the matching database row', async () => {
  const parsed = routeRequestSchema.parse(requestBody());
  await attachPoiIds(
    { ...request, waypoints: [{ ...points[0]!, placeId: 17 }, points[1]!] },
    parsed,
    host([place, { ...place, id: 18, google_place_id: 'amap_BOTHER' }]).ctx,
  );
  expect(parsed.waypoints[0]!.amapId).toBe('B0FFIV1KBY');
});
it.each(
  [
    [place, { ...place, id: 18, google_place_id: 'amap_BOTHER' }],
    [{ ...place, lat: 34.250001 }],
    [{ ...place, google_place_id: 'ChIJ-google' }],
    [{ ...place, google_place_id: 'amap_B123&key=other' }],
  ].map((places) => ({ places })),
)('uses coordinates for ambiguous, moved, foreign or invalid POI IDs', async ({ places }) => {
  const parsed = routeRequestSchema.parse(requestBody());
  await attachPoiIds(request, parsed, host(places).ctx);
  expect(parsed.waypoints.every((point) => point.amapId === undefined)).toBe(true);
});
it('does not borrow POI IDs from a trip the user cannot access', async () => {
  const parsed = routeRequestSchema.parse(requestBody());
  await attachPoiIds(request, parsed, host([place], [2]).ctx);
  expect(parsed.waypoints[0]!.amapId).toBeUndefined();
});

const apps: ReturnType<typeof harness>['app'][] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
it.each(['driving', 'walking'])(
  'forwards raw POI IDs for %s and isolates coordinate-only cache entries',
  async (profile) => {
    const { app, calls } = harness(async () =>
      jsonResponse({
        status: '1',
        route: { paths: [{ distance: '12', duration: '3', steps: [{ polyline: '0,0;1,1' }] }] },
      }),
    );
    apps.push(app);
    const inject = (waypoints: unknown[]) =>
      app.inject({ method: 'POST', url: '/v1/routes', payload: { profile, waypoints } });
    await inject(points);
    await inject([
      { ...points[0], amapId: 'B0FFIV1KBY' },
      { ...points[1], amapId: 'BDESTINATION' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url.searchParams.get('origin_id')).toBe('B0FFIV1KBY');
    expect(calls[1]!.url.searchParams.get('destination_id')).toBe('BDESTINATION');
    expect(calls[1]!.url.searchParams.get('origin')).toBe(calls[0]!.url.searchParams.get('origin'));
  },
);
it.each([true, false])('transit sends POI parameters only as a complete pair: %s', async (both) => {
  const { app, calls } = harness(async (url) =>
    url.pathname.includes('regeo')
      ? defaultResponse(url)
      : jsonResponse({ status: '1', route: { transits: [] } }),
  );
  apps.push(app);
  await app.inject({
    method: 'POST',
    url: '/v1/routes',
    payload: {
      profile: 'transit',
      waypoints: [
        { ...points[0], amapId: 'BSTART' },
        { ...points[1], ...(both ? { amapId: 'BEND' } : {}) },
      ],
    },
  });
  const parameters = calls.find((c) => c.url.pathname.includes('direction'))!.url.searchParams;
  expect(parameters.get('originpoi')).toBe(both ? 'BSTART' : null);
  expect(parameters.get('destinationpoi')).toBe(both ? 'BEND' : null);
  expect(parameters.has('origin_id')).toBe(false);
});
it('does not send undocumented POI parameters to bicycling', async () => {
  const { app, calls } = harness(async () => jsonResponse({ status: '1', route: { paths: [] } }));
  apps.push(app);
  await app.inject({
    method: 'POST',
    url: '/v1/routes',
    payload: { profile: 'cycling', waypoints: [{ ...points[0], amapId: 'BSTART' }, points[1]] },
  });
  expect(calls[0]!.url.searchParams.has('origin_id')).toBe(false);
  expect(calls[0]!.url.searchParams.has('originpoi')).toBe(false);
});
