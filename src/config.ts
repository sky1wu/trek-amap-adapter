import { z } from 'zod';

const positiveInt = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
const envSchema = z.object({
  AMAP_KEY: z.string().trim().min(1).max(256),
  PORT: positiveInt(8080, 65535),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AMAP_TIMEOUT_MS: positiveInt(8000, 15000),
  AMAP_MAX_RESPONSE_BYTES: positiveInt(2_000_000, 10_000_000),
  AMAP_MAX_CONCURRENT: positiveInt(20, 100),
  CACHE_MAX_ENTRIES: positiveInt(1000, 10000),
  AMAP_ENGLISH_ENABLED: z.enum(['true', 'false']).default('false'),
  ADAPTER_TOKEN: z.string().trim().min(16).max(256).optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Zod's full error can include values. Only expose the names of invalid settings.
    throw new Error(
      `Invalid configuration: ${[...new Set(parsed.error.issues.map((issue) => issue.path[0]))].join(', ')}`,
    );
  }
  return parsed.data;
}

export type Config = ReturnType<typeof loadConfig>;
