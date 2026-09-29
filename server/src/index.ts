import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertConfig, config } from './config.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { pingDatabase } from './db/client.js';
import { reconcileAllFindings } from './services/intelligence.js';
import { warmAdapterHealth } from './adapters/index.js';
import { api } from './endpoints/api.js';
import { HttpError } from './helpers/http.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The map needs to load tiles and WMS imagery from public providers.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors({ origin: config.webOrigin === '*' ? true : config.webOrigin.split(','), credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res) => (res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    }),
  );

  app.use((req, _res, next) => {
    req.requestId = (req.id as string) ?? randomUUID();
    next();
  });

  app.use('/api', api);

  // Serve the built single-page application when it exists (production/PWA).
  if (existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
            res.setHeader('cache-control', 'no-cache');
          }
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found', requestId: req.requestId } });
      return;
    }
    res.status(404).send('Not found');
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId ?? null;
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details ?? null, requestId },
      });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        error: { code: 'BAD_JSON', message: 'Request body is not valid JSON', requestId },
      });
      return;
    }
    // Unexpected failures are logged with the request id and never leak internals.
    const message = err instanceof Error ? err.message : 'unexpected error';
    req.log?.error({ err }, 'unhandled error');
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. The failure has been logged.',
        detail: config.isProd ? undefined : message,
        requestId,
      },
    });
  });

  return app;
}

async function main() {
  assertConfig();
  await migrate({ quiet: true });
  await seed({ quiet: true });

  // Findings are derived from current records, so the persisted projection is
  // rebuilt once at boot. Reads also reconcile, so the platform never serves a
  // count that disagrees with the parcel-level engine output.
  const reconciled = await reconcileAllFindings();
  console.log(
    `[bhumisetu] integrity engine reconciled ${reconciled.parcels} parcel(s), ${reconciled.findings} active finding(s)`,
  );

  const db = await pingDatabase();
  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(
      `[bhumisetu] listening on 0.0.0.0:${config.port} — database ${db.ok ? 'healthy' : 'UNAVAILABLE'} (${db.latencyMs}ms), env=${config.env}`,
    );
  });

  // Warm the adapter-health cache after the listener is up. The first request to
  // a status surface then reads a live snapshot instead of an "unprobed" one,
  // and no request ever pays the upstream latency itself.
  setTimeout(() => {
    warmAdapterHealth();
    console.log('[bhumisetu] adapter health warm-up started in the background');
  }, 250).unref();

  const shutdown = (signal: string) => {
    console.log(`[bhumisetu] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.env.BHUMISETU_NO_LISTEN !== 'true') {
  main().catch((err) => {
    console.error('[bhumisetu] fatal startup error:', err);
    process.exit(1);
  });
}
