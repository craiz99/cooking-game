import type { StopId } from '@shared/types';

export interface DeckQuad {
  /** Normalized background-image Y [0..1] where the back row of deck planks starts (safely below railing) */
  topY: number;
  /** Normalized background-image Y [0..1] where the front row of deck planks sits (safely above bottom HUD) */
  bottomY: number;
  /** Normalized background-image X [0..1] of deck left edge at topY */
  topLeftX: number;
  /** Normalized background-image X [0..1] of deck right edge at topY */
  topRightX: number;
  /** Normalized background-image X [0..1] of deck left edge at bottomY */
  bottomLeftX: number;
  /** Normalized background-image X [0..1] of deck right edge at bottomY */
  bottomRightX: number;
}

export interface CoverRect {
  ox: number;
  oy: number;
  rw: number;
  rh: number;
}

export const DEFAULT_SCENE_ASPECT = 1376 / 768;

/**
 * Calibrated 2.5D perspective wooden-deck trapezoids measured directly from each
 * regional kitchen backdrop (client/public/assets/scenes/kitchen_*.webp).
 * Keeps every prep board, pot, fryer, crate, counter, and chef firmly grounded on
 * the painted wooden deck planks—never floating over railings, water, arches, or sky.
 */
export const DECK_QUAD_BY_STOP: Record<StopId, DeckQuad> = {
  sharon: {
    topY: 0.42,
    bottomY: 0.855,
    topLeftX: 0.21,
    topRightX: 0.80,
    bottomLeftX: 0.06,
    bottomRightX: 0.89,
  },
  nyc: {
    topY: 0.41,
    bottomY: 0.86,
    topLeftX: 0.23,
    topRightX: 0.78,
    bottomLeftX: 0.08,
    bottomRightX: 0.90,
  },
  chicago: {
    topY: 0.50,
    bottomY: 0.865,
    topLeftX: 0.22,
    topRightX: 0.75,
    bottomLeftX: 0.06,
    bottomRightX: 0.87,
  },
  austin: {
    topY: 0.54,
    bottomY: 0.855,
    topLeftX: 0.25,
    topRightX: 0.75,
    bottomLeftX: 0.13,
    bottomRightX: 0.86,
  },
  denver: {
    topY: 0.50,
    bottomY: 0.865,
    topLeftX: 0.23,
    topRightX: 0.76,
    bottomLeftX: 0.06,
    bottomRightX: 0.87,
  },
  yosemite: {
    topY: 0.49,
    bottomY: 0.865,
    topLeftX: 0.24,
    topRightX: 0.77,
    bottomLeftX: 0.07,
    bottomRightX: 0.88,
  },
  tahoe: {
    topY: 0.53,
    bottomY: 0.865,
    topLeftX: 0.21,
    topRightX: 0.71,
    bottomLeftX: 0.06,
    bottomRightX: 0.84,
  },
  sanjose: {
    topY: 0.46,
    bottomY: 0.86,
    topLeftX: 0.22,
    topRightX: 0.74,
    bottomLeftX: 0.06,
    bottomRightX: 0.86,
  },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Computes the exact CSS-pixel cover rectangle used to draw a full-bleed kitchen background.
 */
export function getCoverImageRect(
  viewportW: number,
  viewportH: number,
  imgAspect = DEFAULT_SCENE_ASPECT,
): CoverRect {
  let rw = viewportW;
  let rh = viewportW / imgAspect;
  if (rh < viewportH) {
    rh = viewportH;
    rw = viewportH * imgAspect;
  }
  return {
    ox: (viewportW - rw) / 2,
    oy: (viewportH - rh) / 2,
    rw,
    rh,
  };
}

/**
 * Projects a logical kitchen grid coordinate (gx in [0..10], gy in [0.8..5.8])
 * onto the stop's calibrated 2.5D perspective wooden deck in screen CSS pixels.
 */
export function gridToDeckScreen(
  stopId: StopId,
  gx: number,
  gy: number,
  viewportW: number,
  viewportH: number,
  imgAspect = DEFAULT_SCENE_ASPECT,
): { x: number; y: number } {
  const quad = DECK_QUAD_BY_STOP[stopId];
  const rect = getCoverImageRect(viewportW, viewportH, imgAspect);

  const u = Math.max(0, Math.min(1, gx / 10));
  const v = Math.max(0, Math.min(1, (gy - 0.8) / 5.0));

  const yImg = lerp(quad.topY, quad.bottomY, v);
  const leftX = lerp(quad.topLeftX, quad.bottomLeftX, v);
  const rightX = lerp(quad.topRightX, quad.bottomRightX, v);
  const xImg = lerp(leftX, rightX, u);

  const rawX = rect.ox + xImg * rect.rw;
  const rawY = rect.oy + yImg * rect.rh;

  // Keep stations clickable on extreme narrow screens while staying unclamped on iPad/laptop landscape
  const padX = Math.min(48, viewportW * 0.06);
  return {
    x: Math.max(padX, Math.min(viewportW - padX, rawX)),
    y: rawY,
  };
}

/**
 * Inverse projection from screen CSS pixel tap back to logical kitchen grid (gx, gy).
 */
export function screenToDeckGrid(
  stopId: StopId,
  sx: number,
  sy: number,
  viewportW: number,
  viewportH: number,
  imgAspect = DEFAULT_SCENE_ASPECT,
): { gx: number; gy: number } {
  const quad = DECK_QUAD_BY_STOP[stopId];
  const rect = getCoverImageRect(viewportW, viewportH, imgAspect);

  const xImg = (sx - rect.ox) / rect.rw;
  const yImg = (sy - rect.oy) / rect.rh;

  const v = Math.max(0, Math.min(1, (yImg - quad.topY) / (quad.bottomY - quad.topY)));
  const leftX = lerp(quad.topLeftX, quad.bottomLeftX, v);
  const rightX = lerp(quad.topRightX, quad.bottomRightX, v);
  const u = Math.max(0, Math.min(1, (xImg - leftX) / Math.max(0.01, rightX - leftX)));

  return {
    gx: u * 10,
    gy: 0.8 + v * 5.0,
  };
}
