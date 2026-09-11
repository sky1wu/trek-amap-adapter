import type { FetchLike } from '../src/amap/client.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

// Synthetic responses: not live AMap observations.
export const poi = {
  id: 'B0TESTSKP1',
  name: '西安SKP',
  location: '108.953,34.238',
  pname: '陕西省',
  cityname: '西安市',
  adname: '碑林区',
  address: '长安北路261号',
  business: { tel: '029-12345678', rating: '4.7' },
};

export const tip = {
  id: poi.id,
  name: poi.name,
  location: poi.location,
  district: '陕西省西安市碑林区',
  address: poi.address,
};
export const circle = { circle: { center: { latitude: 34.25, longitude: 108.95 }, radius: 50000 } };
export const rectangle = {
  rectangle: {
    low: { latitude: 34.1, longitude: 108.7 },
    high: { latitude: 34.4, longitude: 109.2 },
  },
};
export const searchMask =
  'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.websiteUri,places.nationalPhoneNumber,places.types,places.googleMapsUri,places.businessStatus';
export const detailsMask =
  'id,displayName,formattedAddress,location,rating,userRatingCount,websiteUri,nationalPhoneNumber,regularOpeningHours,googleMapsUri';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function defaultResponse(url: URL): Response {
  if (url.pathname === '/v3/geocode/regeo')
    return jsonResponse({
      status: '1',
      infocode: '10000',
      regeocode: { addressComponent: { citycode: '029', adcode: '610103' } },
    });
  if (url.pathname === '/v3/assistant/inputtips')
    return jsonResponse({ status: '1', infocode: '10000', tips: [tip] });
  return jsonResponse({ status: '1', infocode: '10000', pois: [poi] });
}

export function harness(
  handler: FetchLike = async (url) => defaultResponse(url),
  env: Record<string, string> = {},
) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const config = loadConfig({
    AMAP_KEY: 'server-amap-secret-for-tests',
    LOG_LEVEL: 'silent',
    ...env,
  });
  const app = buildApp(config, {
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  });
  return { app, calls, config };
}
