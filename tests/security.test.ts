import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { isOriginAllowed } from '../server/security.js';

describe('Security & Health Baseline (PR #1)', () => {
  it('returns healthy status with strict privacy & security headers', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('serves robots.txt disallowing all crawlers', async () => {
    const app = createApp();
    const res = await request(app).get('/robots.txt');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Disallow: /');
  });

  it('enforces per-IP rate limiting on API routes', async () => {
    const app = createApp({ apiRateLimitMax: 3 });

    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/health')).status).toBe(200);
    const blocked = await request(app).get('/api/health');
    expect(blocked.status).toBe(429);
  });

  it('validates same-origin strictly for CORS and WebSockets', () => {
    expect(isOriginAllowed(undefined, 'localhost:3000')).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(isOriginAllowed('https://purple-van.fly.dev', 'purple-van.fly.dev')).toBe(true);
    expect(isOriginAllowed('http://192.168.1.42:3000', '192.168.1.42:3000')).toBe(true);

    expect(isOriginAllowed('https://evil.example.com', 'localhost:3000')).toBe(false);
    expect(isOriginAllowed('http://localhost:3000.evil.com', 'localhost:3000')).toBe(false);
    expect(isOriginAllowed('javascript:alert(1)', 'localhost:3000')).toBe(false);
    expect(isOriginAllowed('http://localhost:3000', undefined)).toBe(false);
  });
});
