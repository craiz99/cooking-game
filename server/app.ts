import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { createRateLimiter, createSecurityMiddleware } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  clientDistDir?: string;
  apiRateLimitMax?: number;
}

export function resolveClientDistDir(): string {
  // Works both when run from TS via tsx (server/) and compiled JS (dist/server/server/)
  const candidates = [
    path.resolve(__dirname, '../dist/client'),
    path.resolve(__dirname, '../../client'),
    path.resolve(process.cwd(), 'dist/client'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return path.resolve(process.cwd(), 'dist/client');
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Strict security & privacy headers on every route
  app.use(...createSecurityMiddleware());

  // Strict payload size cap to defeat large-body memory abuse
  app.use(express.json({ limit: '16kb' }));

  const apiLimiter = createRateLimiter({
    windowMs: 60_000,
    max: options.apiRateLimitMax ?? 120,
  });

  app.get('/robots.txt', (_req: Request, res: Response) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  app.get('/api/health', apiLimiter, (_req: Request, res: Response) => {
    res.json({
      ok: true,
      app: 'purple-van-cooking-game',
      timestamp: new Date().toISOString(),
    });
  });

  const clientDistDir = options.clientDistDir ?? resolveClientDistDir();
  if (fs.existsSync(clientDistDir)) {
    app.use(
      express.static(clientDistDir, {
        index: 'index.html',
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );

    // SPA fallback for /trip/:token and client routes (never swallow /api/*)
    app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req: Request, res: Response) => {
      const indexFile = path.join(clientDistDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Client build not found. Run npm run build first.');
      }
    });
  }

  return app;
}
