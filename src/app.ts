import { timingSafeEqual } from 'node:crypto';
import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import { AmapClient, type FetchLike } from './amap/client.js';
import type { Config } from './config.js';
import { ApiError } from './errors.js';
import {
  autocompleteSchema,
  detailsParamsSchema,
  detailsQuerySchema,
  fieldMaskSchema,
  textSearchSchema,
} from './google/requests.js';
import { PlacesService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    cacheHit: boolean;
    startedAt: number;
  }
}

interface AppOptions {
  fetcher?: FetchLike;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp(config: Config, options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers["x-goog-api-key"]'],
    },
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    bodyLimit: 16 * 1024,
    requestTimeout: 20_000,
    connectionTimeout: 20_000,
    keepAliveTimeout: 5000,
    routerOptions: { maxParamLength: 256 },
  });
  app.decorateRequest('cacheHit', false);
  app.decorateRequest('startedAt', 0);
  const service = new PlacesService(config, new AmapClient(config, options.fetcher));

  app.addHook('onRequest', async (request, reply) => {
    request.startedAt = performance.now();
    if (request.routeOptions.url === '/health' || !config.ADAPTER_TOKEN) return;
    const supplied = request.headers['x-goog-api-key'];
    const expected = Buffer.from(config.ADAPTER_TOKEN);
    const actual = typeof supplied === 'string' ? Buffer.from(supplied) : Buffer.alloc(0);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return reply.code(401).send({ error: { message: 'Invalid adapter credential' } });
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url?.replaceAll('::', ':') ?? 'unmatched',
        upstream: request.routeOptions.url === '/health' ? 'none' : 'amap',
        latency: Math.round((performance.now() - request.startedAt) * 100) / 100,
        status: reply.statusCode,
        cacheHit: request.cacheHit,
      },
      'Request completed',
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof ApiError
          ? error.statusCode
          : error instanceof Error &&
              'statusCode' in error &&
              typeof error.statusCode === 'number' &&
              error.statusCode >= 400 &&
              error.statusCode < 500
            ? error.statusCode
            : 500;
    const message =
      error instanceof ApiError
        ? error.message
        : status === 413
          ? 'Request body too large'
          : status < 500
            ? 'Invalid request'
            : 'Internal adapter error';
    // Deliberately avoid logging error objects: fetch/Zod messages can contain keys or input.
    request.log.warn(
      {
        requestId: request.id,
        status,
        infocode: error instanceof ApiError ? error.infocode : undefined,
      },
      'Request failed',
    );
    return reply.code(status).send({ error: { message } });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { message: 'Endpoint not found' } }),
  );

  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/v1/places::searchText', async (request) => {
    fieldMaskSchema.parse(request.headers['x-goog-fieldmask']);
    return service.search(textSearchSchema.parse(request.body), request);
  });
  app.post('/v1/places::autocomplete', async (request) => {
    fieldMaskSchema.parse(request.headers['x-goog-fieldmask']);
    return service.autocomplete(autocompleteSchema.parse(request.body), request);
  });
  app.get('/v1/places/:placeId', async (request) => {
    const { placeId } = detailsParamsSchema.parse(request.params);
    const query = detailsQuerySchema.parse(request.query);
    const mask = fieldMaskSchema.parse(request.headers['x-goog-fieldmask']);
    const fields = mask?.split(',').map((field) => field.trim().split('.')[0]);
    if (
      fields?.length &&
      fields.every(
        (field) => field === 'photos' || field === 'reviews' || field === 'editorialSummary',
      )
    ) {
      return { photos: [], reviews: [] };
    }
    return service.details(placeId, query.languageCode, request);
  });

  return app;
}
