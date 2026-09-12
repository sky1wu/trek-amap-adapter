import { mkdir, writeFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { gcj02ToWgs84 } from '../src/geo/gcj02.js';
import type { RouteProfile, RouteResult } from '../src/routing/requests.js';

if (!process.env.AMAP_KEY) {
  console.log('SKIP: AMAP_KEY is not configured');
  process.exit(0);
}
const config = loadConfig({ ...process.env, LOG_LEVEL: 'silent' });
const app = buildApp(config);
const cases = [
  {
    city: '西安',
    gcj: [
      [108.947042, 34.259431],
      [108.964078, 34.218796],
    ],
    required: true,
  },
  {
    city: '香港',
    gcj: [
      [114.164974, 22.284088],
      [114.168974, 22.278088],
    ],
    required: false,
  },
];
const results: unknown[] = [];
let failed = false;
try {
  for (const sample of cases) {
    const waypoints = sample.gcj.map(([longitude, latitude]) => {
      const p = gcj02ToWgs84({ longitude: longitude!, latitude: latitude! });
      return { lat: p.latitude, lng: p.longitude };
    });
    for (const profile of ['driving', 'walking', 'cycling', 'transit'] as RouteProfile[]) {
      const started = performance.now();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/routes',
        headers: config.ADAPTER_TOKEN ? { 'x-goog-api-key': config.ADAPTER_TOKEN } : {},
        payload: { profile, waypoints },
      });
      const { route, error } = response.json<{
        route?: RouteResult | null;
        error?: { message: string };
      }>();
      const valid =
        route &&
        route.coordinates.length >= 2 &&
        route.legs.length === 1 &&
        route.distance > 0 &&
        route.duration > 0 &&
        route.coordinates.every(
          ([lat, lng]) =>
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lng) <= 180,
        );
      const result = {
        city: sample.city,
        profile,
        status: response.statusCode,
        outcome: valid
          ? 'route'
          : response.statusCode === 200 && route === null
            ? 'unavailable'
            : 'error',
        durationMs: Math.round(performance.now() - started),
        ...(valid
          ? {
              vertices: route.coordinates.length,
              distance: route.distance,
              duration: route.duration,
              first: route.coordinates[0],
              last: route.coordinates.at(-1),
              note: route.legs[0]?.note,
            }
          : { message: error?.message }),
      };
      results.push(result);
      console.log(JSON.stringify(result));
      if ((sample.required && !valid) || result.outcome === 'error') failed = true;
      // Keep this optional smoke script gentle on per-mode QPS quotas.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await mkdir('docs', { recursive: true });
  await writeFile(
    'docs/routes-smoke-results.json',
    JSON.stringify({ at: new Date().toISOString(), node: process.version, results }, null, 2) +
      '\n',
    'utf8',
  );
} finally {
  await app.close();
}
if (failed) process.exitCode = 1;
