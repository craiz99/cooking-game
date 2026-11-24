import os from 'node:os';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  maxTrackedKeys?: number;
}

/**
 * Configures strict HTTP security headers:
 * - Self-hosted Content-Security-Policy (blocks external CDNs & inline script injection)
 * - Referrer-Policy: no-referrer (prevents leaking invite tokens in Referer headers)
 * - X-Robots-Tag: noindex, nofollow (keeps private trip links out of search engines)
 * - X-Frame-Options: DENY (blocks clickjacking)
 */
export function createSecurityMiddleware(): RequestHandler[] {
  const helmetMiddleware = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Do not force upgrade-insecure-requests on local HTTP Wi-Fi;
        // cloud hosts (Fly.io/Railway) enforce HTTPS at the edge.
        upgradeInsecureRequests: null,
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    // Keep HSTS off when running on plain HTTP LAN so Safari on iPad doesn't lock out LAN IP.
    hsts: process.env.ENABLE_HSTS === 'true',
  });

  const privacyHeaders: RequestHandler = (_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  };

  return [helmetMiddleware, privacyHeaders];
}

/**
 * Lightweight, memory-bounded sliding-window per-IP rate limiter.
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, maxTrackedKeys = 5000 } = options;
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;

    const prev = hits.get(key) ?? [];
    const recent = prev.filter((ts) => ts > cutoff);

    if (recent.length >= max) {
      res.status(429).json({ error: 'Too many requests. Please slow down and try again.' });
      return;
    }

    recent.push(now);
    hits.set(key, recent);

    // Opportunistically prune stale entries to keep memory bounded.
    if (hits.size > maxTrackedKeys) {
      for (const [k, timestamps] of hits) {
        if (timestamps.length === 0 || (timestamps[timestamps.length - 1] ?? 0) <= cutoff) {
          hits.delete(k);
        }
      }
    }

    next();
  };
}

/**
 * Strict same-origin validator for CORS and Socket.IO handshakes.
 * Allows requests with no Origin header (same-origin navigation / curl / health checks)
 * or where Origin host matches the request Host header.
 */
export function isOriginAllowed(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin) return true;
  if (!hostHeader) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return parsed.host.toLowerCase() === hostHeader.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Detects the best LAN host/IP to display for home Wi-Fi QR codes.
 * When running inside an isolated Apple Container VM, PUBLIC_HOST is passed in
 * by scripts/run-apple-container.sh so iPads on Wi-Fi receive the Mac's LAN IP.
 */
export function getAdvertisedHost(): string {
  const fromEnv = process.env.PUBLIC_HOST?.trim();
  if (fromEnv) return fromEnv;

  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    const list = nets[name] ?? [];
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
