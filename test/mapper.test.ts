import { describe, expect, it } from 'vitest';
import {
  formatAddress,
  mapAmapPoiToGooglePlace,
  mapAmapTipToGoogleSuggestion,
  parseLocation,
} from '../src/amap/mapper.js';
import { decodePlaceId, encodePlaceId } from '../src/google/id.js';
import { gcj02ToWgs84 } from '../src/geo/gcj02.js';
import { poi, tip } from './fixtures.js';

describe('place IDs', () => {
  it('round trips without entering TREK OSM/URL/photo-ID branches', () => {
    const encoded = encodePlaceId('B0FFFAB6J2');
    expect(encoded).toBe('amap_B0FFFAB6J2');
    expect(encoded).not.toMatch(/[:/?#~]/);
    expect(decodePlaceId(encoded)).toBe('B0FFFAB6J2');
  });
  it.each(['', 'B:123', 'B/12', 'B?x', 'B#x', '../x', 'B|x', 'B_1', '汉字', 'x'.repeat(65)])(
    'rejects unsafe raw ID %s',
    (id) => {
      expect(() => encodePlaceId(id)).toThrow();
      expect(() => decodePlaceId(`amap_${id}`)).toThrow();
    },
  );
  it.each(['amap:B123', 'B123', 'coords:1,2', 'https://example.com', 'amap_B123~p3'])(
    'rejects foreign ID %s',
    (id) => expect(() => decodePlaceId(id)).toThrow(),
  );
});

describe('mapping', () => {
  it('maps real values and leaves Google-only fields unavailable', () => {
    const place = mapAmapPoiToGooglePlace(poi);
    expect(place).toMatchObject({
      id: 'amap_B0TESTSKP1',
      displayName: { text: '西安SKP' },
      formattedAddress: '陕西省西安市碑林区长安北路261号',
      rating: 4.7,
      nationalPhoneNumber: '029-12345678',
      types: [],
      googleMapsUri: null,
      photos: [],
      reviews: [],
    });
    expect(place?.location).toEqual(gcj02ToWgs84({ longitude: 108.953, latitude: 34.238 }));
    expect(place).not.toHaveProperty('businessStatus');
    expect(place).not.toHaveProperty('websiteUri');
    expect(place).not.toHaveProperty('regularOpeningHours');
    expect(place).not.toHaveProperty('userRatingCount');
  });
  it.each([
    undefined,
    [],
    '',
    null,
    { tel: [], rating: '' },
    { tel: null, rating: 'NaN' },
    { rating: '9' },
    { rating: '0' },
  ])('handles empty/unreliable business fields %j', (business) => {
    const place = mapAmapPoiToGooglePlace({ ...poi, business });
    expect(place).toBeDefined();
    expect(place).not.toHaveProperty('rating');
    expect(place).not.toHaveProperty('nationalPhoneNumber');
  });
  it('deduplicates municipalities and full-address overlap', () => {
    expect(formatAddress('北京市', '北京市', '东城区', '东城区景山前街4号')).toBe(
      '北京市东城区景山前街4号',
    );
    expect(formatAddress('陕西省', '西安市', '碑林区', '陕西省西安市碑林区长安北路261号')).toBe(
      '陕西省西安市碑林区长安北路261号',
    );
    expect(formatAddress([], '', null)).toBe('');
  });
  it.each([
    { id: [] },
    { name: '' },
    { location: '200,90' },
    { location: ',' },
    { location: null },
    { id: 'B/123' },
  ])('filters invalid POIs %j', (patch) =>
    expect(mapAmapPoiToGooglePlace({ ...poi, ...patch })).toBeUndefined(),
  );
  it('maps a tip to a resolvable suggestion', () =>
    expect(mapAmapTipToGoogleSuggestion(tip)).toMatchObject({
      placePrediction: {
        placeId: 'amap_B0TESTSKP1',
        structuredFormat: { mainText: { text: '西安SKP' } },
      },
    }));
  it.each([{ id: [] }, { id: '' }, { location: '' }, { location: [] }])(
    'drops non-POI tips %j',
    (patch) => expect(mapAmapTipToGoogleSuggestion({ ...tip, ...patch })).toBeUndefined(),
  );
  it('preserves zero coordinates', () =>
    expect(parseLocation('0,0')).toEqual({ longitude: 0, latitude: 0 }));
  it.each(['', '1,', ',2', '1,2,3', 'Infinity,2', '1,NaN', '181,1', '1,-91', '0x10,1'])(
    'rejects invalid location %s',
    (location) => expect(parseLocation(location)).toBeUndefined(),
  );
});
