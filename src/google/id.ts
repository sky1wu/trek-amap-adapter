const RAW_ID = /^[A-Za-z0-9]{1,64}$/;
const PLACE_ID = /^amap_([A-Za-z0-9]{1,64})$/;

export function encodePlaceId(id: string): string {
  if (!RAW_ID.test(id)) throw new RangeError('Invalid AMap POI ID');
  return `amap_${id}`;
}

export function decodePlaceId(id: string): string {
  const raw = PLACE_ID.exec(id)?.[1];
  if (!raw) throw new RangeError('Invalid adapter place ID');
  return raw;
}
