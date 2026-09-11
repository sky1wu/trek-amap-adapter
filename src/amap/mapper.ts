import { gcj02ToWgs84 } from '../geo/gcj02.js';
import { isValidCoordinate, type Coordinate } from '../geo/types.js';
import { encodePlaceId } from '../google/id.js';
import type { GooglePlace, GoogleSuggestion } from '../google/types.js';
import { poiSchema, stringValue, tipSchema } from './types.js';

export function parseLocation(value: unknown): Coordinate | undefined {
  if (typeof value !== 'string' || !/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(value))
    return undefined;
  const [longitude, latitude] = value.split(',').map(Number);
  if (longitude === undefined || latitude === undefined) return undefined;
  const point = { longitude, latitude };
  return isValidCoordinate(point) ? point : undefined;
}

export function formatAddress(...values: unknown[]): string {
  let address = '';
  for (const value of values) {
    const part = stringValue(value);
    if (!part || address.includes(part)) continue;
    if (part.startsWith(address)) {
      address = part;
      continue;
    }
    // Reconcile overlapping province/city/district prefixes in full addresses.
    let overlap = Math.min(address.length, part.length);
    while (overlap > 0 && !address.endsWith(part.slice(0, overlap))) overlap--;
    address += part.slice(overlap);
  }
  return address;
}

export function mapAmapPoiToGooglePlace(raw: unknown): GooglePlace | undefined {
  const parsed = poiSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const poi = parsed.data;
  const id = stringValue(poi.id);
  const name = stringValue(poi.name);
  const point = parseLocation(poi.location);
  if (!id || !/^[A-Za-z0-9]{1,64}$/.test(id) || !name || !point) return undefined;
  const ratingInput = poi.business?.rating;
  const ratingText = stringValue(ratingInput);
  const rating =
    typeof ratingInput === 'number'
      ? ratingInput
      : ratingText && /^\d+(?:\.\d+)?$/.test(ratingText)
        ? Number(ratingText)
        : undefined;
  const phone = stringValue(poi.business?.tel);
  return {
    id: encodePlaceId(id),
    displayName: { text: name },
    formattedAddress: formatAddress(poi.pname, poi.cityname, poi.adname, poi.address),
    location: gcj02ToWgs84(point),
    ...(rating !== undefined && rating > 0 && rating <= 5 ? { rating } : {}),
    ...(phone ? { nationalPhoneNumber: phone } : {}),
    // AMap classifications are not Google types. Leave absent information empty.
    types: [],
    googleMapsUri: null,
    photos: [],
    reviews: [],
  };
}

export function mapAmapTipToGoogleSuggestion(raw: unknown): GoogleSuggestion | undefined {
  const parsed = tipSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const tip = parsed.data;
  const id = stringValue(tip.id);
  const name = stringValue(tip.name);
  if (!id || !/^[A-Za-z0-9]{1,64}$/.test(id) || !name || !parseLocation(tip.location))
    return undefined;
  return {
    placePrediction: {
      placeId: encodePlaceId(id),
      structuredFormat: {
        mainText: { text: name },
        secondaryText: { text: formatAddress(tip.district, tip.address) },
      },
    },
  };
}
