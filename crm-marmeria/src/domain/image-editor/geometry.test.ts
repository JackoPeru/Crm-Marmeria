import { describe, expect, it } from 'vitest';
import {
  brushPreviewSpec,
  exportLineWidth,
  imageToScreen,
  normalizeCropRect,
  previewLineWidth,
  screenToImage,
  zoomAtScreenPoint,
} from './geometry';

describe('image editor geometry', () => {
  const image = { width: 1200, height: 800 };
  const viewport = { width: 900, height: 600 };
  const camera = { scale: 0.5, pan: { x: 37, y: -21 } };

  it('round-trips image and screen coordinates', () => {
    const sourcePoint = { x: 740, y: 260 };
    const screenPoint = imageToScreen(sourcePoint, image, viewport, camera);
    expect(screenToImage(screenPoint, image, viewport, camera).x).toBeCloseTo(sourcePoint.x);
    expect(screenToImage(screenPoint, image, viewport, camera).y).toBeCloseTo(sourcePoint.y);
  });

  it('keeps zoom anchor image point fixed', () => {
    const anchor = { x: 628, y: 214 };
    const anchorOnScreen = imageToScreen(anchor, image, viewport, camera);
    const zoomed = zoomAtScreenPoint(camera, image, viewport, anchorOnScreen, 1.25);
    const zoomedAnchor = imageToScreen(anchor, image, viewport, zoomed);
    expect(zoomedAnchor.x).toBeCloseTo(anchorOnScreen.x);
    expect(zoomedAnchor.y).toBeCloseTo(anchorOnScreen.y);
  });

  it('normalizes and clamps crop rectangle to native image bounds', () => {
    expect(normalizeCropRect({ x: 1100, y: 720 }, { x: -40, y: 70 }, image)).toEqual({
      x: 0,
      y: 70,
      width: 1100,
      height: 650,
    });
    expect(normalizeCropRect({ x: 400, y: 500 }, { x: 100, y: 200 }, image)).toEqual({
      x: 100,
      y: 200,
      width: 300,
      height: 300,
    });
  });

  it('uses preview width divided by viewport zoom but exports native width', () => {
    expect(previewLineWidth(8, 0.25)).toBeCloseTo(32);
    expect(previewLineWidth(8, 2)).toBeCloseTo(4);
    expect(exportLineWidth(8)).toBe(8);
    expect(brushPreviewSpec(8, 0.5)).toMatchObject({ size: 16, epsilon: expect.any(Number) });
    expect(brushPreviewSpec(8, 0.5).epsilon).toBeCloseTo(brushPreviewSpec(8, 1).epsilon * 2);
  });
});
