export type Point = Readonly<{
  x: number;
  y: number;
}>;

export type ImageSize = Readonly<{
  width: number;
  height: number;
}>;

export type ViewportSize = Readonly<{
  width: number;
  height: number;
}>;

export type Camera = Readonly<{
  scale: number;
  pan: Point;
}>;

export type ImageRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type BrushPreviewSpec = Readonly<{
  size: number;
  epsilon: number;
}>;

export const MIN_VIEWPORT_ZOOM = 0.02;

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export const clamp = (value: number, min: number, max: number): number => {
  const safeValue = finite(value, min);
  return Math.min(max, Math.max(min, safeValue));
};

export const fitScale = (
  viewport: ViewportSize,
  image: ImageSize,
  padding = 24,
): number => {
  const width = Math.max(1, finite(image.width, 1));
  const height = Math.max(1, finite(image.height, 1));
  const availableWidth = Math.max(1, finite(viewport.width, 1) - padding * 2);
  const availableHeight = Math.max(1, finite(viewport.height, 1) - padding * 2);
  return Math.max(MIN_VIEWPORT_ZOOM, Math.min(availableWidth / width, availableHeight / height));
};

export const imageToScreen = (
  point: Point,
  image: ImageSize,
  viewport: ViewportSize,
  camera: Camera,
): Point => {
  const scale = Math.max(MIN_VIEWPORT_ZOOM, finite(camera.scale, 1));
  return {
    x: viewport.width / 2 + camera.pan.x + (point.x - image.width / 2) * scale,
    y: viewport.height / 2 + camera.pan.y + (point.y - image.height / 2) * scale,
  };
};

export const screenToImage = (
  point: Point,
  image: ImageSize,
  viewport: ViewportSize,
  camera: Camera,
): Point => {
  const scale = Math.max(MIN_VIEWPORT_ZOOM, finite(camera.scale, 1));
  return {
    x: image.width / 2 + (point.x - viewport.width / 2 - camera.pan.x) / scale,
    y: image.height / 2 + (point.y - viewport.height / 2 - camera.pan.y) / scale,
  };
};

export const zoomAtScreenPoint = (
  camera: Camera,
  image: ImageSize,
  viewport: ViewportSize,
  screenPoint: Point,
  nextScale: number,
): Camera => {
  const scale = Math.max(MIN_VIEWPORT_ZOOM, finite(nextScale, camera.scale));
  const imagePoint = screenToImage(screenPoint, image, viewport, camera);
  return {
    scale,
    pan: {
      x: screenPoint.x - viewport.width / 2 - (imagePoint.x - image.width / 2) * scale,
      y: screenPoint.y - viewport.height / 2 - (imagePoint.y - image.height / 2) * scale,
    },
  };
};

export const scaleForZoomPercent = (fit: number, percent: number): number => (
  Math.max(MIN_VIEWPORT_ZOOM, fit * clamp(percent, 25, 800) / 100)
);

export const zoomPercent = (scale: number, fit: number): number => (
  clamp((Math.max(MIN_VIEWPORT_ZOOM, finite(scale, fit)) / Math.max(MIN_VIEWPORT_ZOOM, fit)) * 100, 25, 800)
);

export const clampImagePoint = (point: Point, image: ImageSize): Point => ({
  x: clamp(point.x, 0, Math.max(0, image.width)),
  y: clamp(point.y, 0, Math.max(0, image.height)),
});

export const normalizeCropRect = (
  start: Point,
  end: Point,
  image: ImageSize,
): ImageRect => {
  const first = clampImagePoint(start, image);
  const second = clampImagePoint(end, image);
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const right = Math.max(first.x, second.x);
  const bottom = Math.max(first.y, second.y);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
};

export const distanceBetween = (first: Point, second: Point): number => Math.hypot(
  first.x - second.x,
  first.y - second.y,
);

export const stabilizationEpsilon = (stabilization: number): number => {
  const min = 0.03;
  const max = 0.18;
  return min + ((1 - clamp(stabilization, 0, 1)) * (max - min));
};

export const previewLineWidth = (baseWidth: number, viewportZoom: number): number => (
  Math.max(0.1, finite(baseWidth, 0.1)) / Math.max(MIN_VIEWPORT_ZOOM, finite(viewportZoom, 1))
);

export const exportLineWidth = (baseWidth: number): number => Math.max(0.1, finite(baseWidth, 0.1));

export const brushPreviewSpec = (
  baseWidth: number,
  viewportZoom: number,
  stabilization = 0.4,
): BrushPreviewSpec => {
  const zoom = Math.max(MIN_VIEWPORT_ZOOM, finite(viewportZoom, 1));
  return {
    size: Math.max(0.1, finite(baseWidth, 0.1)) / zoom,
    epsilon: stabilizationEpsilon(stabilization) / zoom,
  };
};
