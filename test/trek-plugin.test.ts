import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { createMockHost, validateManifest } from 'trek-plugin-sdk';
import plugin from '../trek-plugins/provider.js';

afterEach(async () => {
  await plugin.onUnload?.(createMockHost().ctx);
  vi.unstubAllGlobals();
});
const request = {
  tripId: 7,
  dayId: 2,
  profile: 'driving',
  waypoints: [
    { lat: 0, lng: 0, name: 'private name', placeId: 17 },
    { lat: 1, lng: 1 },
  ],
};
function response() {
  return Response.json({
    status: '1',
    route: {
      paths: [{ distance: '123', cost: { duration: '45' }, steps: [{ polyline: '0,0;1,1' }] }],
    },
  });
}
it.each(['amap-routes', 'amap-transit'])(
  '%s satisfies the official manifest and only allows AMap egress',
  (id) => {
    const manifest: unknown = JSON.parse(
      readFileSync(`trek-plugins/${id}/trek-plugin.json`, 'utf8'),
    );
    expect(validateManifest(manifest)).toMatchObject({
      ok: true,
      errors: [],
      manifest: {
        egress: ['restapi.amap.com'],
        permissions: ['hook:route-provider', 'db:read:trips', 'http:outbound:restapi.amap.com'],
      },
    });
  },
);
it('runs the shared route service directly against the fixed public AMap endpoint', async () => {
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    expect(url.origin).toBe('https://restapi.amap.com');
    expect(url.pathname).toBe('/v5/direction/driving');
    expect(url.searchParams.get('key')).toBe('test-amap-key');
    expect(url.searchParams.get('origin')).toBe('0.000000,0.000000');
    expect(url.href).not.toContain('private');
    expect(url.href).not.toContain('placeId');
    expect(init.redirect).toBe('error');
    expect(init.body).toBeUndefined();
    return response();
  });
  vi.stubGlobal('fetch', fetcher);
  const host = createMockHost({
    grants: ['hook:route-provider', 'http:outbound:restapi.amap.com'],
    config: { amapKey: 'test-amap-key' },
  });
  const result = await plugin.hooks!.routeProvider!.getRoute(request, host.ctx);
  expect(result).toEqual({
    coordinates: [
      [0, 0],
      [1, 1],
    ],
    distance: 123,
    duration: 45,
    legs: [{ distance: 123, duration: 45 }],
  });
  expect(host.calls.map((call) => call.method)).toEqual(['trips.getPlaces']);
  await plugin.hooks!.routeProvider!.getRoute(request, host.ctx);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not expose credentials or upstream error text', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('secret-key https://sensitive.example');
    }),
  );
  await expect(
    plugin.hooks!.routeProvider!.getRoute(
      request,
      createMockHost({ config: { amapKey: 'secret-key' } }).ctx,
    ),
  ).rejects.toThrow('高德路线暂不可用');
});
it('passes the stored adapter POI ID through the plugin into an AMap route request', async () => {
  const fetcher = vi.fn(async (url: URL) => {
    expect(url.searchParams.get('origin_id')).toBe('B0FFIV1KBY');
    expect(url.searchParams.has('destination_id')).toBe(false);
    return response();
  });
  vi.stubGlobal('fetch', fetcher);
  const host = createMockHost({
    actingUserId: 1,
    grants: ['db:read:trips'],
    config: { amapKey: 'test' },
    trips: {
      7: { members: [1], places: [{ id: 17, lat: 0, lng: 0, google_place_id: 'amap_B0FFIV1KBY' }] },
    },
  });
  await plugin.hooks!.routeProvider!.getRoute(request, host.ctx);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('requires a configured Key before fetching', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    plugin.hooks!.routeProvider!.getRoute(request, createMockHost().ctx),
  ).rejects.toThrow('高德路线暂不可用');
  expect(fetcher).not.toHaveBeenCalled();
});
it('validates waypoints inside the plugin', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    plugin.hooks!.routeProvider!.getRoute(
      {
        ...request,
        waypoints: [
          { lat: 91, lng: 0 },
          { lat: 1, lng: 1 },
        ],
      },
      createMockHost({ config: { amapKey: 'test' } }).ctx,
    ),
  ).rejects.toThrow('高德路线暂不可用');
  expect(fetcher).not.toHaveBeenCalled();
});
it('drops the old client and cache when the Key changes', async () => {
  const keys: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      keys.push(url.searchParams.get('key')!);
      return response();
    }),
  );
  await plugin.hooks!.routeProvider!.getRoute(
    request,
    createMockHost({ config: { amapKey: 'first' } }).ctx,
  );
  await plugin.hooks!.routeProvider!.getRoute(
    request,
    createMockHost({ config: { amapKey: 'second' } }).ctx,
  );
  expect(keys).toEqual(['first', 'second']);
});
it('uses TREK failure fallback when no route exists', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: '1', route: { paths: [] } })),
  );
  await expect(
    plugin.hooks!.routeProvider!.getRoute(
      request,
      createMockHost({ config: { amapKey: 'test' } }).ctx,
    ),
  ).rejects.toThrow('高德路线暂不可用');
});
