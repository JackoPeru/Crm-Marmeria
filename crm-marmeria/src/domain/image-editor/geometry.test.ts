import { describe, expect, it } from 'vitest';
import {
  imageToScreen,
  nativeBrushSpecAtViewportZoom,
  normalizeViewportZoom,
  renderedStrokeWidthAtViewportZoom,
  normalizeCropRect,
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

  it('salva width ed epsilon nativi secondo zoom di creazione', () => {
    const specs = [0.5, 1, 2].map((zoom) => nativeBrushSpecAtViewportZoom(8, zoom));
    expect(specs.map((spec) => spec.nativeWidth)).toEqual([16, 8, 4]);
    expect(specs[0].nativeEpsilon).toBeCloseTo(specs[1].nativeEpsilon * 2);
    expect(specs[2].nativeEpsilon).toBeCloseTo(specs[1].nativeEpsilon / 2);
    expect(normalizeViewportZoom(0)).toBe(0.02);
  });

  it('renderizza stroke nativo sotto trasformazione e mantiene export uguale al modello', () => {
    [[0.5, 16], [1, 8], [2, 4]].forEach(([zoom, expectedNativeWidth]) => {
      const spec = nativeBrushSpecAtViewportZoom(8, zoom);
      expect(spec.nativeWidth).toBeCloseTo(expectedNativeWidth);
      expect(renderedStrokeWidthAtViewportZoom(spec.nativeWidth, zoom)).toBeCloseTo(8);
    });
    expect(nativeBrushSpecAtViewportZoom(8, 2).nativeWidth).toBe(4);
    expect(nativeBrushSpecAtViewportZoom(8, 0.5).nativeWidth).toBe(16);
  });
});
