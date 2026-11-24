import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Zero-Cutoff Start Page & Responsive Viewport Sizing (PR #22)', () => {
  const css = fs.readFileSync(
    path.resolve(process.cwd(), 'client/src/styles/storybook.css'),
    'utf8',
  );

  it('uses 100dvh safe dynamic viewport sizing so iPad Safari toolbars never cut off screens', () => {
    expect(css).toContain('height: 100dvh');
    expect(css).toContain('calc(100dvh - 24px)');
  });

  it('uses safe margin-auto flex centering on .lobby-card and compact short-height media rules', () => {
    expect(css).toMatch(/\.lobby-card\s*\{[\s\S]*?margin:\s*auto 0 auto auto;/);
    expect(css).toContain('@media (max-height: 700px)');
  });
});
