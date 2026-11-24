import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TARGET_FILES = [
  'client/src/styles/storybook.css',
  'client/src/screens/LobbyScreen.ts',
  'client/src/screens/RoadTripMapScreen.ts',
  'client/src/screens/KitchenScreen.ts',
];

describe('iPad-Friendly Large Typography Scale (PR #16)', () => {
  it('enforces a minimum readable font size of >= 13px across all CSS, inline styles, and Canvas labels', () => {
    const violations: string[] = [];

    for (const rel of TARGET_FILES) {
      const full = path.resolve(process.cwd(), rel);
      const src = fs.readFileSync(full, 'utf8');
      const lines = src.split('\n');

      lines.forEach((line, idx) => {
        // Match CSS font-size: Npx, JS .fontSize = 'Npx', or ctx.font = '... Npx ...'
        const matches = [
          ...line.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g),
          ...line.matchAll(/fontSize\s*=\s*['"](\d+(?:\.\d+)?)px['"]/g),
          ...line.matchAll(/ctx\.font\s*=\s*['"][^'"]*?(\d+(?:\.\d+)?)px/g),
        ];
        for (const m of matches) {
          const px = Number(m[1]);
          if (px < 13) {
            violations.push(`${rel}:${idx + 1} -> ${px}px (${line.trim()})`);
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
