import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Crop,
  Maximize2,
  Move,
  Pencil,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import Modal from '../common/Modal';
import {
  brushPreviewSpec,
  clamp,
  clampImagePoint,
  distanceBetween,
  exportLineWidth,
  fitScale,
  ImageRect,
  ImageSize,
  imageToScreen as imagePointToScreen,
  normalizeCropRect,
  Point,
  previewLineWidth,
  scaleForZoomPercent,
  screenToImage,
  ViewportSize,
  zoomAtScreenPoint,
  zoomPercent,
} from '../../domain/image-editor/geometry';

const MIN_BRUSH_SIZE = 1.5;
const MAX_BRUSH_SIZE = 28;
const DEFAULT_BRUSH_SIZE = 5;
const DEFAULT_BRUSH_COLOR = '#ef4444';
const DEFAULT_STABILIZATION = 0.4;

type EditorTool = 'draw' | 'crop' | 'pan';

type Stroke = {
  points: Point[];
  color: string;
  width: number;
};

type EditorSnapshot = {
  strokes: Stroke[];
  crop: ImageRect | null;
};

type EditorInteraction =
  | { type: 'draw'; pointerId: number; stroke: Stroke }
  | { type: 'crop'; pointerId: number; start: Point; current: Point }
  | { type: 'pan'; pointerId: number; startScreen: Point; startPan: Point };

export interface ProjectImageEditorProps {
  isOpen: boolean;
  source: Blob | null;
  originalName: string;
  onClose: () => void;
  onSave: (file: File) => Promise<void>;
}

const emptySnapshot = (): EditorSnapshot => ({ strokes: [], crop: null });

const safeImageSize = (image: ImageSize): ImageSize => ({
  width: Math.max(1, image.width),
  height: Math.max(1, image.height),
});

const drawStroke = (
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  viewportZoom: number | null,
  offset: Point = { x: 0, y: 0 },
) => {
  if (!stroke.points.length) return;
  const lineWidth = viewportZoom === null
    ? exportLineWidth(stroke.width)
    : previewLineWidth(stroke.width, viewportZoom);
  const points = stroke.points.map((point) => ({
    x: point.x + offset.x,
    y: point.y + offset.y,
  }));

  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = lineWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.stroke();
  }
  context.restore();
};

const drawCropOverlay = (
  context: CanvasRenderingContext2D,
  crop: ImageRect,
  image: ImageSize,
  viewport: ViewportSize,
  camera: { scale: number; pan: Point },
) => {
  const topLeft = imagePointToScreen({ x: crop.x, y: crop.y }, image, viewport, camera);
  const bottomRight = imagePointToScreen(
    { x: crop.x + crop.width, y: crop.y + crop.height },
    image,
    viewport,
    camera,
  );
  const left = Math.min(topLeft.x, bottomRight.x);
  const top = Math.min(topLeft.y, bottomRight.y);
  const width = Math.abs(bottomRight.x - topLeft.x);
  const height = Math.abs(bottomRight.y - topLeft.y);

  context.save();
  context.fillStyle = 'rgba(3, 7, 18, 0.58)';
  context.beginPath();
  context.rect(0, 0, viewport.width, viewport.height);
  context.rect(left, top, width, height);
  context.fill('evenodd');
  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;
  context.setLineDash([7, 5]);
  context.strokeRect(left, top, width, height);
  context.setLineDash([]);
  context.fillStyle = '#ffffff';
  const handleSize = 8;
  [
    [left, top],
    [left + width, top],
    [left, top + height],
    [left + width, top + height],
  ].forEach(([x, y]) => context.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize));
  context.restore();
};

const buildEditedName = (originalName: string): string => {
  const base = originalName
    .replace(/\.[^/.]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .trim() || 'immagine';
  return `${base}-modificata-${Date.now()}.png`;
};

const ProjectImageEditor: React.FC<ProjectImageEditorProps> = ({
  isOpen,
  source,
  originalName,
  onClose,
  onSave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageSizeRef = useRef<ImageSize>({ width: 0, height: 0 });
  const viewportRef = useRef<ViewportSize>({ width: 0, height: 0 });
  const cameraRef = useRef({ scale: 1, pan: { x: 0, y: 0 } });
  const snapshotRef = useRef<EditorSnapshot>(emptySnapshot());
  const historyRef = useRef<EditorSnapshot[]>([snapshotRef.current]);
  const historyIndexRef = useRef(0);
  const interactionRef = useRef<EditorInteraction | null>(null);
  const frameRef = useRef<number | null>(null);
  const viewInitializedRef = useRef(false);
  const toolRef = useRef<EditorTool>('draw');
  const colorRef = useRef(DEFAULT_BRUSH_COLOR);
  const brushSizeRef = useRef(DEFAULT_BRUSH_SIZE);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
  const [camera, setCamera] = useState(cameraRef.current);
  const [snapshot, setSnapshot] = useState(snapshotRef.current);
  const [tool, setTool] = useState<EditorTool>('draw');
  const [color, setColor] = useState(DEFAULT_BRUSH_COLOR);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const resetSnapshot = useCallback(() => {
    const next = emptySnapshot();
    snapshotRef.current = next;
    historyRef.current = [next];
    historyIndexRef.current = 0;
    setSnapshot(next);
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const currentImage = imageRef.current;
    const currentViewport = viewportRef.current;
    if (!canvas || !currentViewport.width || !currentViewport.height) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(currentViewport.width * dpr));
    const pixelHeight = Math.max(1, Math.round(currentViewport.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, currentViewport.width, currentViewport.height);
    context.fillStyle = '#111827';
    context.fillRect(0, 0, currentViewport.width, currentViewport.height);

    const currentSize = imageSizeRef.current;
    if (!currentImage || !currentSize.width || !currentSize.height) {
      context.fillStyle = '#d1d5db';
      context.font = '14px system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText('Caricamento immagine…', currentViewport.width / 2, currentViewport.height / 2);
      return;
    }

    const currentCamera = cameraRef.current;
    const currentSnapshot = snapshotRef.current;
    const imageCenter = { x: currentSize.width / 2, y: currentSize.height / 2 };
    context.save();
    context.translate(currentViewport.width / 2 + currentCamera.pan.x, currentViewport.height / 2 + currentCamera.pan.y);
    context.scale(currentCamera.scale, currentCamera.scale);
    context.translate(-imageCenter.x, -imageCenter.y);
    context.imageSmoothingEnabled = true;
    context.drawImage(currentImage, 0, 0, currentSize.width, currentSize.height);
    currentSnapshot.strokes.forEach((stroke) => drawStroke(context, stroke, currentCamera.scale));
    const interaction = interactionRef.current;
    if (interaction?.type === 'draw') drawStroke(context, interaction.stroke, currentCamera.scale);
    context.restore();

    const effectiveCrop = interaction?.type === 'crop'
      ? normalizeCropRect(interaction.start, interaction.current, currentSize)
      : currentSnapshot.crop;
    if (toolRef.current === 'crop' && effectiveCrop && effectiveCrop.width > 0 && effectiveCrop.height > 0) {
      drawCropOverlay(context, effectiveCrop, currentSize, currentViewport, currentCamera);
    }
  }, []);

  const requestFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      drawFrame();
    });
  }, [drawFrame]);

  const applyCamera = useCallback((next: typeof cameraRef.current) => {
    cameraRef.current = next;
    setCamera(next);
    requestFrame();
  }, [requestFrame]);

  const commitSnapshot = useCallback((next: EditorSnapshot) => {
    const history = historyRef.current.slice(0, historyIndexRef.current + 1);
    history.push(next);
    historyRef.current = history;
    historyIndexRef.current = history.length - 1;
    snapshotRef.current = next;
    setSnapshot(next);
    requestFrame();
  }, [requestFrame]);

  useEffect(() => {
    toolRef.current = tool;
    colorRef.current = color;
    brushSizeRef.current = brushSize;
    requestFrame();
  }, [brushSize, color, requestFrame, tool]);

  useEffect(() => {
    if (!isOpen || !source) {
      imageRef.current = null;
      setImage(null);
      setImageSize({ width: 0, height: 0 });
      imageSizeRef.current = { width: 0, height: 0 };
      return undefined;
    }

    let active = true;
    const objectUrl = URL.createObjectURL(source);
    const nextImage = new Image();
    viewInitializedRef.current = false;
    interactionRef.current = null;
    resetSnapshot();
    setError('');
    setImage(null);
    imageRef.current = null;
    imageSizeRef.current = { width: 0, height: 0 };
    nextImage.onload = () => {
      if (!active) return;
      const nextSize = safeImageSize({
        width: nextImage.naturalWidth || nextImage.width,
        height: nextImage.naturalHeight || nextImage.height,
      });
      imageRef.current = nextImage;
      imageSizeRef.current = nextSize;
      setImageSize(nextSize);
      setImage(nextImage);
      requestFrame();
    };
    nextImage.onerror = () => {
      if (active) setError('Impossibile caricare l’immagine.');
    };
    nextImage.src = objectUrl;

    return () => {
      active = false;
      nextImage.onload = null;
      nextImage.onerror = null;
      nextImage.src = '';
      URL.revokeObjectURL(objectUrl);
    };
  }, [isOpen, requestFrame, resetSnapshot, source]);

  useEffect(() => {
    if (!imageSize.width || !imageSize.height || !viewport.width || !viewport.height) return;
    if (!viewInitializedRef.current) {
      const next = { scale: fitScale(viewport, imageSize), pan: { x: 0, y: 0 } };
      viewInitializedRef.current = true;
      applyCamera(next);
    } else {
      requestFrame();
    }
  }, [applyCamera, imageSize, requestFrame, viewport]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const host = canvasHostRef.current;
    if (!host) return undefined;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const next = {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
      viewportRef.current = next;
      setViewport(next);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen]);

  useEffect(() => {
    requestFrame();
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [camera, image, requestFrame, snapshot, viewport, tool]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const imagePoint = (point: Point): Point => clampImagePoint(
    screenToImage(point, imageSizeRef.current, viewportRef.current, cameraRef.current),
    imageSizeRef.current,
  );

  const rawImagePoint = (point: Point): Point => screenToImage(
    point,
    imageSizeRef.current,
    viewportRef.current,
    cameraRef.current,
  );

  const isInsideImage = (point: Point): boolean => (
    point.x >= 0
    && point.y >= 0
    && point.x <= imageSizeRef.current.width
    && point.y <= imageSizeRef.current.height
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageRef.current || !imageSizeRef.current.width || !imageSizeRef.current.height) return;
    event.preventDefault();
    const screen = canvasPoint(event);
    const rawPoint = rawImagePoint(screen);
    if (toolRef.current !== 'pan' && !isInsideImage(rawPoint)) return;
    const point = clampImagePoint(rawPoint, imageSizeRef.current);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture non disponibile in alcuni browser embedded.
    }

    if (toolRef.current === 'draw') {
      const stroke: Stroke = {
        points: [point],
        color: colorRef.current,
        width: clamp(brushSizeRef.current, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE),
      };
      interactionRef.current = { type: 'draw', pointerId: event.pointerId, stroke };
    } else if (toolRef.current === 'crop') {
      interactionRef.current = { type: 'crop', pointerId: event.pointerId, start: point, current: point };
    } else {
      interactionRef.current = {
        type: 'pan',
        pointerId: event.pointerId,
        startScreen: screen,
        startPan: { ...cameraRef.current.pan },
      };
    }
    requestFrame();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const screen = canvasPoint(event);
    if (interaction.type === 'draw') {
      const point = imagePoint(screen);
      const lastPoint = interaction.stroke.points[interaction.stroke.points.length - 1];
      const previewSpec = brushPreviewSpec(interaction.stroke.width, cameraRef.current.scale, DEFAULT_STABILIZATION);
      if (distanceBetween(lastPoint, point) >= previewSpec.epsilon) interaction.stroke.points.push(point);
    } else if (interaction.type === 'crop') {
      interaction.current = imagePoint(screen);
    } else {
      cameraRef.current = {
        ...cameraRef.current,
        pan: {
          x: interaction.startPan.x + screen.x - interaction.startScreen.x,
          y: interaction.startPan.y + screen.y - interaction.startScreen.y,
        },
      };
    }
    requestFrame();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);

    if (!cancelled && interaction.type === 'draw') {
      const finalPoint = imagePoint(canvasPoint(event));
      const lastPoint = interaction.stroke.points[interaction.stroke.points.length - 1];
      if (distanceBetween(lastPoint, finalPoint) > 0.1) interaction.stroke.points.push(finalPoint);
      const nextStroke = { ...interaction.stroke, points: [...interaction.stroke.points] };
      commitSnapshot({
        strokes: [...snapshotRef.current.strokes, nextStroke],
        crop: snapshotRef.current.crop,
      });
    } else if (!cancelled && interaction.type === 'crop') {
      const crop = normalizeCropRect(interaction.start, interaction.current, imageSizeRef.current);
      if (crop.width >= 1 && crop.height >= 1) {
        commitSnapshot({ strokes: snapshotRef.current.strokes, crop });
      }
    } else if (interaction.type === 'pan') {
      setCamera(cameraRef.current);
    }
    interactionRef.current = null;
    requestFrame();
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!imageRef.current || !imageSizeRef.current.width || !imageSizeRef.current.height) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const currentFit = fitScale(viewportRef.current, imageSizeRef.current);
    const currentZoom = zoomPercent(cameraRef.current.scale, currentFit);
    const nextZoom = clamp(currentZoom + (event.deltaY < 0 ? 10 : -10), 25, 800);
    const next = zoomAtScreenPoint(
      cameraRef.current,
      imageSizeRef.current,
      viewportRef.current,
      anchor,
      scaleForZoomPercent(currentFit, nextZoom),
    );
    applyCamera(next);
  };

  const fitView = () => {
    if (!imageSizeRef.current.width || !imageSizeRef.current.height || !viewportRef.current.width || !viewportRef.current.height) return;
    applyCamera({ scale: fitScale(viewportRef.current, imageSizeRef.current), pan: { x: 0, y: 0 } });
  };

  const zoomBy = (delta: number) => {
    if (!imageSizeRef.current.width || !imageSizeRef.current.height || !viewportRef.current.width || !viewportRef.current.height) return;
    const currentFit = fitScale(viewportRef.current, imageSizeRef.current);
    const currentZoom = zoomPercent(cameraRef.current.scale, currentFit);
    const nextZoom = clamp(currentZoom + delta, 25, 800);
    const center = { x: viewportRef.current.width / 2, y: viewportRef.current.height / 2 };
    applyCamera(zoomAtScreenPoint(
      cameraRef.current,
      imageSizeRef.current,
      viewportRef.current,
      center,
      scaleForZoomPercent(currentFit, nextZoom),
    ));
  };

  const undo = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const next = historyRef.current[historyIndexRef.current];
    snapshotRef.current = next;
    setSnapshot(next);
    requestFrame();
  };

  const redo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const next = historyRef.current[historyIndexRef.current];
    snapshotRef.current = next;
    setSnapshot(next);
    requestFrame();
  };

  const reset = () => {
    resetSnapshot();
    fitView();
    setError('');
    requestFrame();
  };

  const exportImage = async (): Promise<Blob> => {
    const currentImage = imageRef.current;
    const currentSize = imageSizeRef.current;
    if (!currentImage || !currentSize.width || !currentSize.height) throw new Error('Immagine non pronta');
    const currentSnapshot = snapshotRef.current;
    const crop = currentSnapshot.crop && currentSnapshot.crop.width >= 1 && currentSnapshot.crop.height >= 1
      ? currentSnapshot.crop
      : { x: 0, y: 0, width: currentSize.width, height: currentSize.height };
    const width = Math.max(1, Math.round(crop.width));
    const height = Math.max(1, Math.round(crop.height));
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const context = exportCanvas.getContext('2d');
    if (!context) throw new Error('Canvas non disponibile');
    context.imageSmoothingEnabled = true;
    context.drawImage(currentImage, -crop.x, -crop.y, currentSize.width, currentSize.height);
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    currentSnapshot.strokes.forEach((stroke) => drawStroke(context, stroke, null, { x: -crop.x, y: -crop.y }));
    context.restore();
    return new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Esportazione PNG non riuscita'));
      }, 'image/png');
    });
  };

  const save = async () => {
    if (saving || !imageRef.current) return;
    setSaving(true);
    setError('');
    try {
      const blob = await exportImage();
      await onSave(new File([blob], buildEditedName(originalName), { type: 'image/png', lastModified: Date.now() }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Salvataggio copia non riuscito');
    } finally {
      setSaving(false);
    }
  };

  const currentFit = imageSize.width && viewport.width ? fitScale(viewport, imageSize) : 1;
  const currentZoom = Math.round(zoomPercent(camera.scale, currentFit));
  const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-sm transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-light-primary disabled:cursor-not-allowed disabled:opacity-40 dark:border-dark-border dark:hover:bg-dark-input';
  const activeToolClass = 'bg-light-secondary text-light-primary dark:bg-dark-secondary dark:text-white';

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!saving) onClose(); }}
      title={`Modifica immagine: ${originalName}`}
      size="6xl"
      closeLabel="Chiudi editor immagine"
    >
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Strumenti editor immagine">
          <button type="button" className={`${buttonClass} ${tool === 'draw' ? activeToolClass : ''}`} aria-pressed={tool === 'draw'} title="Disegna" onClick={() => setTool('draw')}>
            <Pencil size={16} /> Disegna
          </button>
          <button type="button" className={`${buttonClass} ${tool === 'crop' ? activeToolClass : ''}`} aria-pressed={tool === 'crop'} title="Ritaglia" onClick={() => setTool('crop')}>
            <Crop size={16} /> Ritaglia
          </button>
          <button type="button" className={`${buttonClass} ${tool === 'pan' ? activeToolClass : ''}`} aria-pressed={tool === 'pan'} title="Sposta" onClick={() => setTool('pan')}>
            <Move size={16} /> Sposta
          </button>
          <span className="mx-1 hidden h-6 w-px bg-light-border sm:block dark:bg-dark-border" aria-hidden="true" />
          <label className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm dark:border-dark-border" title="Colore tratto">
            <span>Colore</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Colore tratto" className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
          </label>
          <label className="inline-flex min-w-[170px] flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm dark:border-dark-border sm:flex-none" title="Spessore tratto in pixel immagine">
            <span className="whitespace-nowrap">Spessore {brushSize.toFixed(1)} px</span>
            <input type="range" min={MIN_BRUSH_SIZE} max={MAX_BRUSH_SIZE} step="0.5" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} aria-label="Spessore tratto in pixel immagine" className="min-w-0 flex-1 accent-light-primary" />
          </label>
        </div>

        <div ref={canvasHostRef} className="h-[clamp(220px,54vh,520px)] min-h-[220px] min-w-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
          <canvas
            ref={canvasRef}
            className={`block h-full w-full touch-none focus:outline-none focus:ring-2 focus:ring-light-primary ${tool === 'draw' ? 'cursor-crosshair' : tool === 'crop' ? 'cursor-crosshair' : 'cursor-grab'}`}
            aria-label="Area immagine modificabile"
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={(event) => handlePointerUp(event, true)}
            onWheel={handleWheel}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-gray-500 dark:text-gray-300" aria-live="polite">
            {tool === 'draw' && 'Trascina sull’immagine per disegnare.'}
            {tool === 'crop' && 'Trascina per definire il ritaglio.'}
            {tool === 'pan' && 'Trascina per spostare la vista.'}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={buttonClass} onClick={undo} disabled={historyIndexRef.current <= 0} title="Annulla" aria-label="Annulla ultima modifica"><Undo2 size={16} /> Annulla</button>
            <button type="button" className={buttonClass} onClick={redo} disabled={historyIndexRef.current >= historyRef.current.length - 1} title="Ripristina" aria-label="Ripristina modifica"><Redo2 size={16} /> Ripristina</button>
            <button type="button" className={buttonClass} onClick={reset} title="Ripristina immagine originale nell’editor" aria-label="Reset editor"><RotateCcw size={16} /> Reset</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-gray-50 p-2 dark:border-dark-border dark:bg-dark-input">
          <div className="flex items-center gap-1.5">
            <button type="button" className={buttonClass} onClick={() => zoomBy(-25)} disabled={!image} title="Zoom out" aria-label="Riduci zoom"><ZoomOut size={16} /></button>
            <span className="min-w-[4.5rem] text-center font-medium" aria-live="polite">{currentZoom}%</span>
            <button type="button" className={buttonClass} onClick={() => zoomBy(25)} disabled={!image} title="Zoom in" aria-label="Aumenta zoom"><ZoomIn size={16} /></button>
            <button type="button" className={buttonClass} onClick={fitView} disabled={!image} title="Adatta immagine alla vista" aria-label="Adatta immagine"><Maximize2 size={16} /> Adatta</button>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-300">Zoom ancorato al puntatore · esportazione PNG a dimensioni native</span>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200" role="alert">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose} disabled={saving}>Chiudi</button>
          <button type="button" className="inline-flex items-center gap-2 rounded-md bg-light-primary px-4 py-2 text-sm font-medium text-white hover:bg-purple-800 focus:outline-none focus:ring-2 focus:ring-light-primary disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void save()} disabled={saving || !image} title="Salva come nuova immagine PNG">
            <Save size={16} /> {saving ? 'Salvataggio…' : 'Salva copia PNG'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ProjectImageEditor;
