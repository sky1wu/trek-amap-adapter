import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { AmapClient } from '../src/amap/client.js';
import { parseLocation } from '../src/amap/mapper.js';
import { poiSchema } from '../src/amap/types.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ApiError } from '../src/errors.js';
import { decodePlaceId } from '../src/google/id.js';
import type { GooglePlace, GoogleSuggestion } from '../src/google/types.js';

const cases = [
  ['西安SKP', 108.95, 34.25],
  ['西安城墙', 108.95, 34.25],
  ['大唐不夜城', 108.95, 34.25],
  ['西安北站', 108.95, 34.25],
  ['北京故宫', 116.397, 39.916],
  ['上海虹桥站', 121.327, 31.2],
  ['深圳湾口岸', 113.94, 22.5],
  ['广州塔', 113.324, 23.106],
  ['成都太古里', 104.081, 30.652],
  ['杭州西湖', 120.148, 30.243],
] as const;

async function smoke() {
  if (!process.env.AMAP_KEY?.trim()) {
    console.log('SKIPPED: AMAP_KEY is not configured; no live API calls were made.');
    return;
  }
  const config = loadConfig();
  const app = buildApp(config, { logger: false });
  const rawClient = new AmapClient(config);
  const headers = { 'x-goog-api-key': config.ADAPTER_TOKEN ?? 'trek-amap-adapter' };
  const results: Record<string, unknown>[] = [];
  try {
    for (const [query, longitude, latitude] of cases) {
      try {
        const bias = { circle: { center: { longitude, latitude }, radius: 50000 } };
        const search = await app.inject({
          method: 'POST',
          url: '/v1/places:searchText',
          headers,
          payload: { textQuery: query, languageCode: 'zh-CN', locationBias: bias },
        });
        if (search.statusCode !== 200) throw new ApiError(search.statusCode, 'Search failed');
        const found = search.json<{ places: GooglePlace[] }>().places[0];
        if (!found) throw new ApiError(404, 'No search results');
        await delay(600);
        const autocomplete = await app.inject({
          method: 'POST',
          url: '/v1/places:autocomplete',
          headers,
          payload: {
            input: query.slice(0, -1),
            languageCode: 'zh-CN',
            sessionToken: 'live-smoke',
            locationBias: bias,
          },
        });
        const suggestions =
          autocomplete.json<{ suggestions?: GoogleSuggestion[] }>().suggestions ?? [];
        if (autocomplete.statusCode !== 200 || !suggestions.length)
          throw new ApiError(502, 'Autocomplete failed or empty');
        await delay(600);
        const suggestionId = suggestions[0]?.placePrediction.placeId;
        if (!suggestionId) throw new ApiError(502, 'Missing autocomplete place ID');
        const suggestionDetails = await app.inject({
          url: `/v1/places/${suggestionId}?languageCode=zh-CN&sessionToken=live-smoke`,
          headers,
        });
        if (suggestionDetails.statusCode !== 200)
          throw new ApiError(suggestionDetails.statusCode, 'Autocomplete selection details failed');
        await delay(600);
        const details = await app.inject({
          url: `/v1/places/${found.id}?languageCode=zh-CN&sessionToken=live-smoke`,
          headers,
        });
        if (details.statusCode !== 200) throw new ApiError(details.statusCode, 'Details failed');
        const place = details.json<GooglePlace>();
        await delay(600);
        const raw = await rawClient.details({ id: decodePlaceId(place.id) });
        const rawPoi = raw.pois
          .map((value) => poiSchema.safeParse(value))
          .find((value) => value.success && value.data.id === decodePlaceId(place.id));
        const gcj02 = rawPoi?.success ? parseLocation(rawPoi.data.location) : undefined;
        if (!gcj02 || !place.displayName.text || !place.formattedAddress)
          throw new ApiError(502, 'Incomplete place fields');
        results.push({
          query,
          status: 'passed-api-only',
          placeId: place.id,
          name: place.displayName.text,
          address: place.formattedAddress,
          suggestions: suggestions.length,
          selectedSuggestionId: suggestionId,
          gcj02,
          wgs84: place.location,
          osmReviewUrl: `https://www.openstreetmap.org/?mlat=${place.location.latitude}&mlon=${place.location.longitude}#map=18/${place.location.latitude}/${place.location.longitude}`,
          visualVerification: 'pending',
          trekSaveAndRestart: 'pending',
        });
        console.log(`PASS API: ${query}`);
      } catch (error) {
        results.push({
          query,
          status: 'failed',
          httpStatus: error instanceof ApiError ? error.statusCode : 502,
          infocode: error instanceof ApiError ? error.infocode : undefined,
        });
        console.log(`FAIL API: ${query}`);
        process.exitCode = 1;
      }
      await delay(600);
    }
  } finally {
    await app.close();
  }
  await mkdir('docs', { recursive: true });
  await writeFile(
    'docs/smoke-results.json',
    JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + '\n',
    'utf8',
  );
  console.log(
    'Saved docs/smoke-results.json. Manually verify the map, saved places and TREK restart.',
  );
}

try {
  await smoke();
} catch {
  console.error('Smoke test failed; check configuration and output permissions.');
  process.exitCode = 1;
}
