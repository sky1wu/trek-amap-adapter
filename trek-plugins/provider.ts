import type { PluginDefinition, PluginContext } from 'trek-plugin-sdk';
import { AmapClient } from '../src/amap/client.js';
import { loadConfig } from '../src/config.js';
import { RoutingService } from '../src/routing/service.js';
import { routeRequestSchema } from '../src/routing/requests.js';
import { attachPoiIds } from './poi-ids.js';

// A module instance belongs to one TREK plugin child. No trip records are cached.
let currentKey: string | undefined;
let service: RoutingService | undefined;
function routing(ctx: PluginContext): RoutingService {
  const value = ctx.config.amapKey;
  if (typeof value !== 'string' || !value.trim())
    throw new Error('请在插件实例设置中填写高德 Web 服务 Key');
  const key = value.trim();
  if (!service || currentKey !== key) {
    const config = loadConfig({
      AMAP_KEY: key,
      LOG_LEVEL: 'silent',
      AMAP_MAX_CONCURRENT: '3',
      CACHE_MAX_ENTRIES: '100',
    });
    service = new RoutingService(config, new AmapClient(config));
    currentKey = key;
  }
  return service;
}
const plugin: PluginDefinition = {
  onUnload() {
    service = undefined;
    currentKey = undefined;
  },
  hooks: {
    routeProvider: {
      async getRoute(request, ctx) {
        try {
          const parsed = routeRequestSchema.parse({
            profile: request.profile,
            waypoints: request.waypoints.map(({ lat, lng }) => ({ lat, lng })),
          });
          if (parsed.profile !== 'cycling') await attachPoiIds(request, parsed, ctx);
          const { route } = await routing(ctx).route(parsed, { cacheHit: false });
          if (!route) throw new Error();
          return route;
        } catch {
          // TREK treats a failed hook as an unavailable route; do not expose keys,
          // coordinates or raw upstream errors through its plugin error log.
          throw new Error('高德路线暂不可用，请检查插件 Key、服务权限、配额及路线覆盖');
        }
      },
    },
  },
};
export default plugin;
