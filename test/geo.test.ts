import { describe, expect, it } from 'vitest';
import { isInsideChina } from '../src/geo/china.js';
import { gcj02ToWgs84, wgs84ToGcj02 } from '../src/geo/gcj02.js';

const cities = [
  ['北京', 116.397128, 39.916527],
  ['上海', 121.4737, 31.2304],
  ['西安', 108.9398, 34.3416],
  ['深圳', 114.0579, 22.5431],
  ['广州', 113.2644, 23.1291],
  ['成都', 104.0665, 30.5728],
  ['海口', 110.3312, 20.0311],
] as const;

describe('mainland coordinate transforms', () => {
  it.each(cities)('%s: both round trips are below one metre', (_name, longitude, latitude) => {
    const input = { longitude, latitude };
    expect(isInsideChina(input)).toBe(true);
    const gcj = wgs84ToGcj02(input);
    expect(Math.hypot(gcj.longitude - longitude, gcj.latitude - latitude)).toBeGreaterThan(0.001);
    const wgsRoundTrip = gcj02ToWgs84(gcj);
    const gcjRoundTrip = wgs84ToGcj02(gcj02ToWgs84(input));
    for (const result of [wgsRoundTrip, gcjRoundTrip]) {
      expect(
        Math.hypot(result.longitude - longitude, result.latitude - latitude) * 111320,
      ).toBeLessThan(1);
    }
  });

  it('matches a fixed Beijing numerical regression vector, not only its own inverse', () => {
    const gcj = wgs84ToGcj02({ longitude: 116.397128, latitude: 39.916527 });
    expect(gcj.longitude).toBeCloseTo(116.40337249402477, 8);
    expect(gcj.latitude).toBeCloseTo(39.91793074924595, 8);
  });

  it.each([
    ['香港', 114.166, 22.298],
    ['澳门', 113.5439, 22.1987],
    ['台北', 121.5654, 25.033],
    ['东京', 139.6917, 35.6895],
    ['首尔', 126.978, 37.5665],
    ['河内', 105.8342, 21.0278],
    ['加德满都', 85.324, 27.7172],
    ['乌兰巴托', 106.9057, 47.8864],
    ['海参崴', 131.886, 43.1155],
    ['伦敦', -0.1276, 51.5072],
    ['零坐标', 0, 0],
  ] as const)('%s stays unchanged outside the mainland', (_name, longitude, latitude) => {
    const input = { longitude, latitude };
    expect(isInsideChina(input)).toBe(false);
    expect(wgs84ToGcj02(input)).toEqual(input);
    expect(gcj02ToWgs84(input)).toEqual(input);
  });

  it.each([
    { longitude: NaN, latitude: 20 },
    { longitude: 181, latitude: 30 },
    { longitude: 10, latitude: Infinity },
  ])('rejects invalid points', (point) => {
    expect(isInsideChina(point)).toBe(false);
    expect(() => wgs84ToGcj02(point)).toThrow(RangeError);
    expect(() => gcj02ToWgs84(point)).toThrow(RangeError);
  });
});
