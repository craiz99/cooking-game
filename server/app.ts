import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { createRateLimiter, createSecurityMiddleware, getAdvertisedHost } from './security.js';
import { TripStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  clientDistDir?: string;
  apiRateLimitMax?: number;
  createTripRateLimitMax?: number;
  store?: TripStore;
  hostSecret?: string;
}

export function resolveClientDistDir(): string {
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

function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const store = options.store ?? new TripStore();
  const hostSecret = (options.hostSecret ?? process.env.HOST_SECRET ?? '').trim();

  // Strict security & privacy headers on every route
  app.use(...createSecurityMiddleware());

  // Strict payload size cap to defeat large-body memory abuse
  app.use(express.json({ limit: '16kb' }));

  const apiLimiter = createRateLimiter({
    windowMs: 60_000,
    max: options.apiRateLimitMax ?? 120,
  });

  const createTripLimiter = createRateLimiter({
    windowMs: 60_000,
    max: options.createTripRateLimitMax ?? 15,
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

  app.get('/api/config', apiLimiter, (_req: Request, res: Response) => {
    res.json({
      requiresHostSecret: hostSecret.length > 0,
      advertisedHost: getAdvertisedHost(),
    });
  });

  /**
   * Create a brand-new private road trip with a 192-bit unguessable invite token.
   * Never exposes any list of existing trips.
   */
  app.post('/api/trips', createTripLimiter, (req: Request, res: Response) => {
    if (hostSecret.length > 0) {
      const provided = typeof req.body?.hostSecret === 'string' ? req.body.hostSecret.trim() : '';
      if (!provided || !timingSafeEquals(provided, hostSecret)) {
        res.status(403).json({
          error: 'A valid family host passphrase is required to start a new road trip.',
        });
        return;
      }
    }

    const soloMode = Boolean(req.body?.soloMode);
    const pace = req.body?.pace === 'rush' ? 'rush' : 'cozy';
    const trip = store.createTrip({ soloMode, pace });
    res.status(201).json({
      token: trip.token,
      invitePath: `/trip/${trip.token}`,
      trip,
    });
  });

  /**
   * Look up a single trip by its secret invite token.
   */
  app.get('/api/trips/:token', apiLimiter, (req: Request, res: Response) => {
    const token = String(req.params.token ?? '');
    const trip = store.getTrip(token);
    if (!trip) {
      res.status(404).json({ error: 'Road trip not found.' });
      return;
    }
    res.json({ trip });
  });

  /**
   * Generate a scannable QR code data URL for the trip's invite link (great for iPads on Wi-Fi!).
   */
  app.get('/api/trips/:token/qr', apiLimiter, async (req: Request, res: Response) => {
    const token = String(req.params.token ?? '');
    const trip = store.getTrip(token);
    if (!trip) {
      res.status(404).json({ error: 'Road trip not found.' });
      return;
    }

    const proto = req.protocol === 'https' ? 'https' : 'http';
    const reqHost = req.get('host') ?? `localhost:${process.env.PORT ?? 3000}`;
    const advertisedHost = getAdvertisedHost();
    const port = process.env.PORT ?? '3000';
    // If accessed via localhost on MacBook, advertise LAN IP in QR code so iPad can scan it!
    const qrHost =
      reqHost.startsWith('localhost') || reqHost.startsWith('127.0.0.1')
        ? advertisedHost === 'localhost'
          ? reqHost
          : `${advertisedHost}:${port}`
        : reqHost;

    const inviteUrl = `${proto}://${qrHost}/trip/${trip.token}`;
    try {
      const dataUrl = await QRCode.toDataURL(inviteUrl, {
        width: 240,
        margin: 2,
        color: { dark: '#4a2511', light: '#fffdf7' },
      });
      res.json({ inviteUrl, dataUrl });
    } catch {
      res.status(500).json({ error: 'Failed to generate QR code.' });
    }
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
