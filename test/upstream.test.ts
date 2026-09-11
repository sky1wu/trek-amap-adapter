import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { AmapClient } from '../src/amap/client.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { ApiError } from '../src/errors.js';
import { defaultResponse, harness, jsonResponse } from './fixtures.js';

const apps: FastifyInstance[] = [];
function setup(...args: Parameters<typeof harness>) {
  const result = harness(...args);
  apps.push(result.app);
  return result;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const request = {
  method: 'POST' as const,
  url: '/v1/places:searchText',
  payload: { textQuery: '西安SKP' },
};

describe('upstream failures', () => {
  it.each([
    ['10001', 503],
    ['10002', 503],
    ['10009', 503],
    ['10041', 503],
    ['40000', 503],
    ['10003', 429],
    ['10004', 429],
    ['10014', 429],
    ['10015', 429],
    ['10020', 429],
    ['10021', 429],
    ['10044', 429],
    ['20000', 400],
    ['20001', 400],
    ['20003', 502],
    ['30001', 502],
    ['99999', 502],
  ])('maps business infocode %s to HTTP %s', async (infocode, status) => {
    const { app } = setup(async () =>
      jsonResponse({ status: '0', infocode, info: 'secret upstream fragment' }),
    );
    const res = await app.inject(request);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toHaveProperty('error.message');
    expect(res.body).not.toContain('secret upstream fragment');
  });

  it.each([
    [429, 429],
    [504, 504],
    [500, 502],
    [302, 502],
  ])('maps HTTP %s with a non-JSON body', async (upstream, status) => {
    const { app } = setup(
      async () => new Response('<html>private upstream error</html>', { status: upstream }),
    );
    const res = await app.inject(request);
    expect(res.statusCode).toBe(status);
    expect(res.body).not.toContain('private upstream error');
  });

  it.each([
    {},
    { status: '1' },
    { status: '2', pois: [] },
    { status: '1', pois: {} },
    { status: '1', infocode: 'bad-secret', pois: [] },
  ])('rejects malformed upstream response %j', async (body) => {
    const { app } = setup(async () => jsonResponse(body));
    expect((await app.inject(request)).statusCode).toBe(502);
  });

  it('handles non-JSON success bodies and network errors', async () => {
    const invalidJson = setup(async () => new Response('bad-json-secret'));
    expect((await invalidJson.app.inject(request)).statusCode).toBe(502);
    const network = setup(async () => {
      throw new Error('request https://restapi.amap.com?key=secret');
    });
    const res = await network.app.inject(request);
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('key=');
  });

  it('does not cache a failed search', async () => {
    let attempts = 0;
    const { app, calls } = setup(async (url) =>
      ++attempts === 1 ? jsonResponse({ status: '0', infocode: '10003' }) : defaultResponse(url),
    );
    expect((await app.inject(request)).statusCode).toBe(429);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('times out before headers arrive', async () => {
    const { app } = setup(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('sensitive abort')), {
            once: true,
          });
        }),
      { AMAP_TIMEOUT_MS: '20' },
    );
    expect((await app.inject(request)).statusCode).toBe(504);
  });

  it('times out while streaming the response body, not only until headers', async () => {
    const { app } = setup(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
              init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), {
                once: true,
              });
            },
          }),
        ),
      { AMAP_TIMEOUT_MS: '20' },
    );
    expect((await app.inject(request)).statusCode).toBe(504);
  });

  it('caps declared and streamed response sizes', async () => {
    for (const headers of [{ 'content-length': '9999' }, {}]) {
      const { app } = setup(async () => new Response('x'.repeat(129), { headers }), {
        AMAP_MAX_RESPONSE_BYTES: '128',
      });
      expect((await app.inject(request)).statusCode).toBe(502);
    }
  });

  it('bounds concurrent upstream work and releases the slot afterwards', async () => {
    const config = loadConfig({ AMAP_KEY: 'test-key', AMAP_MAX_CONCURRENT: '1' });
    let release: ((response: Response) => void) | undefined;
    const client = new AmapClient(
      config,
      async () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const first = client.search({ keywords: 'one' });
    await expect(client.search({ keywords: 'two' })).rejects.toMatchObject({ statusCode: 503 });
    release?.(jsonResponse({ status: '1', pois: [] }));
    await expect(first).resolves.toEqual({ pois: [] });
    const next = client.search({ keywords: 'three' });
    release?.(jsonResponse({ status: '1', pois: [] }));
    await expect(next).resolves.toEqual({ pois: [] });
  });
});

describe('secret hygiene', () => {
  it('logs required metadata and infocode without keys, auth headers or upstream bodies', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const config = loadConfig({ AMAP_KEY: 'amap-secret-to-hide' });
    let fail = false;
    const app = buildApp(config, {
      logger: { level: 'info', stream },
      fetcher: async (url) =>
        fail
          ? jsonResponse({ status: '0', infocode: '10001', info: `key=${config.AMAP_KEY}` })
          : defaultResponse(url),
    });
    apps.push(app);
    const headers = {
      'x-goog-api-key': 'google-secret-to-hide',
      authorization: 'Bearer auth-secret-to-hide',
      'x-request-id': 'attacker-controlled-request-id',
    };
    await app.inject({ ...request, headers });
    await app.inject({ ...request, headers });
    fail = true;
    const res = await app.inject({ url: '/v1/places/amap_B0TESTSKP1', headers });
    await app.inject({ url: '/not-found?key=query-secret-to-hide', headers });
    expect(res.statusCode).toBe(503);
    const logs = lines.join('');
    for (const secret of [
      'amap-secret-to-hide',
      'google-secret-to-hide',
      'auth-secret-to-hide',
      'query-secret-to-hide',
      'attacker-controlled-request-id',
    ]) {
      expect(logs).not.toContain(secret);
      expect(res.body).not.toContain(secret);
    }
    expect(logs).toContain('10001');
    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const completed = entries.filter((line) => line.msg === 'Request completed');
    expect(completed.length).toBeGreaterThan(0);
    for (const entry of completed)
      for (const field of [
        'requestId',
        'method',
        'route',
        'upstream',
        'latency',
        'status',
        'cacheHit',
      ])
        expect(entry).toHaveProperty(field);
    expect(completed.some((entry) => entry.cacheHit === true)).toBe(true);
  });

  it('preserves infocode on a non-200 error without reflecting upstream info', async () => {
    const client = new AmapClient(loadConfig({ AMAP_KEY: 'test' }), async () =>
      jsonResponse({ status: '0', infocode: '10021', info: 'secret' }, 503),
    );
    await expect(client.search({ keywords: 'test' })).rejects.toMatchObject({
      statusCode: 429,
      infocode: '10021',
    } satisfies Partial<ApiError>);
  });

  it('validates configuration without exposing its values', () => {
    expect(() => loadConfig({})).toThrow('AMAP_KEY');
    expect(() => loadConfig({ AMAP_KEY: 'secret', PORT: 'secret-invalid-port' })).toThrow('PORT');
    try {
      loadConfig({ AMAP_KEY: 'secret', ADAPTER_TOKEN: 'short' });
    } catch (error) {
      expect(String(error)).not.toContain('short');
    }
  });
});
