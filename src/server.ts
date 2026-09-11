import { buildApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = buildApp(config);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 15_000).unref();
    try {
      await app.close();
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  await app.listen({ port: config.PORT, host: config.HOST });
} catch {
  // Configuration/listen errors must not dump process.env or raw library exceptions.
  process.stderr.write(
    'Adapter startup failed; check AMAP_KEY, configuration and port availability.\n',
  );
  process.exitCode = 1;
}
