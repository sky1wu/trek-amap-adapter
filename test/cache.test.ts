import { expect, it } from 'vitest';
import { TtlCache } from '../src/cache.js';

it('expires at the TTL boundary and retains recently used entries', () => {
  let time = 100;
  const cache = new TtlCache<string>(2, () => time);
  cache.set('a', 'A', 100);
  cache.set('b', 'B', 100);
  expect(cache.get('a')).toBe('A');
  cache.set('c', 'C', 100);
  expect(cache.get('b')).toBeUndefined();
  expect(cache.size).toBe(2);
  time = 200;
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('c')).toBeUndefined();
});

it('does not evict live entries in favour of expired entries', () => {
  let time = 0;
  const cache = new TtlCache<string>(2, () => time);
  cache.set('live', 'L', 100);
  cache.set('expired', 'E', 10);
  time = 11;
  cache.set('new', 'N', 20);
  expect(cache.get('live')).toBe('L');
  expect(cache.get('new')).toBe('N');
  cache.set('zero', 'Z', 0);
  expect(cache.get('zero')).toBeUndefined();
});
