import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Point } from './layoutEngines';

export interface BackgroundImage {
  src: string;
  xFt: number;
  yFt: number;
  widthFt: number;
  heightFt: number;
}

interface LoadedImage {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}

interface ScaleBar {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface BedShapeEditorProps {
  // Not restored into the canvas on open — the original freehand pixel path
  // and scale-bar calibration aren't persisted, only the resulting feet-space
  // polygon, so "Edit Shape" starts a fresh trace over the existing photo
  // rather than attempting an imprecise reconstruction of the old one.
  initialPolygon: Point[] | null;
  initialBackgroundImage: BackgroundImage | null;
  onCancel: () => void;
  onSave: (polygon: Point[], bedWidth: number, bedHeight: number, backgroundImage: BackgroundImage | null) => void;
}

const DEFAULT_CANVAS = { width: 800, height: 600 };
const MAX_IMAGE_EDGE = 1600;
// Minimum pixel movement (in canvas units) between kept freehand points, so a
// full-perimeter trace stays a few hundred points instead of thousands.
const TRACE_MIN_STEP_FRACTION = 0.006;

const defaultScaleBar = (width: number, height: number): ScaleBar => ({
  x1: width * 0.3,
  y1: height * 0.92,
  x2: width * 0.7,
  y2: height * 0.92,
});

export default function BedShapeEditor({ initialBackgroundImage, onCancel, onSave }: BedShapeEditorProps) {
  const [step, setStep] = useState<'scale' | 'trace'>('scale');
  const [image, setImage] = useState<LoadedImage | null>(() => {
    if (!initialBackgroundImage) return null;
    // Natural pixel size isn't persisted directly; it's recovered once the
    // <img> we render below fires onLoad (see handleImageElementLoad).
    return { src: initialBackgroundImage.src, naturalWidth: 0, naturalHeight: 0 };
  });
  const [scaleBar, setScaleBar] = useState<ScaleBar>(() => defaultScaleBar(DEFAULT_CANVAS.width, DEFAULT_CANVAS.height));
  const [scaleFeet, setScaleFeet] = useState('10');
  const [draggingHandle, setDraggingHandle] = useState<'a' | 'b' | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [pathPoints, setPathPoints] = useState<Point[]>([]);
  const [outline, setOutline] = useState<Point[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const canvasSize = image && image.naturalWidth > 0
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : DEFAULT_CANVAS;

  const toCanvasCoords = (e: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvasSize.width,
      y: ((e.clientY - rect.top) / rect.height) * canvasSize.height,
    };
  };

  // When editing an existing shape, only the (already-downscaled) data URL
  // was persisted — recover its true pixel dimensions by loading it once.
  useEffect(() => {
    if (!initialBackgroundImage) return;
    const img = new Image();
    img.onload = () => {
      setImage({ src: initialBackgroundImage.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      setScaleBar(defaultScaleBar(img.naturalWidth, img.naturalHeight));
    };
    img.src = initialBackgroundImage.src;
    // Only ever recover the image this editor was opened with, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        setImage({ src: canvas.toDataURL('image/jpeg', 0.85), naturalWidth: w, naturalHeight: h });
        setScaleBar(defaultScaleBar(w, h));
        setOutline(null);
        setPathPoints([]);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleClearImage = () => {
    setImage(null);
    setScaleBar(defaultScaleBar(DEFAULT_CANVAS.width, DEFAULT_CANVAS.height));
    setOutline(null);
    setPathPoints([]);
  };

  const handleCanvasPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (step !== 'trace' || draggingHandle) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = toCanvasCoords(e);
    setIsDrawing(true);
    setOutline(null);
    setPathPoints([pt]);
  };

  const handleCanvasPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pt = toCanvasCoords(e);
    if (draggingHandle) {
      setScaleBar(prev => draggingHandle === 'a' ? { ...prev, x1: pt.x, y1: pt.y } : { ...prev, x2: pt.x, y2: pt.y });
      return;
    }
    if (!isDrawing) return;
    const minStep = Math.max(canvasSize.width, canvasSize.height) * TRACE_MIN_STEP_FRACTION;
    setPathPoints(prev => {
      const last = prev[prev.length - 1];
      if (last) {
        const dx = pt.x - last.x;
        const dy = pt.y - last.y;
        if (Math.sqrt(dx * dx + dy * dy) < minStep) return prev;
      }
      return [...prev, pt];
    });
  };

  const handleCanvasPointerUp = () => {
    setDraggingHandle(null);
    if (isDrawing) {
      setIsDrawing(false);
      setPathPoints(prev => {
        if (prev.length >= 3) setOutline(prev);
        return prev;
      });
    }
  };

  const ftPerPixel = (() => {
    const dx = scaleBar.x2 - scaleBar.x1;
    const dy = scaleBar.y2 - scaleBar.y1;
    const barLengthPx = Math.sqrt(dx * dx + dy * dy);
    const feet = parseFloat(scaleFeet);
    return barLengthPx > 0 && feet > 0 ? feet / barLengthPx : 0;
  })();

  const canProceedToTrace = ftPerPixel > 0;
  const canSave = outline !== null && outline.length >= 3 && ftPerPixel > 0;

  const handleSave = () => {
    if (!outline || ftPerPixel <= 0) return;
    const polygonFt = outline.map(p => ({ x: p.x * ftPerPixel, y: p.y * ftPerPixel }));
    const minX = Math.min(...polygonFt.map(p => p.x));
    const minY = Math.min(...polygonFt.map(p => p.y));
    const maxX = Math.max(...polygonFt.map(p => p.x));
    const maxY = Math.max(...polygonFt.map(p => p.y));
    const normalized = polygonFt.map(p => ({ x: p.x - minX, y: p.y - minY }));

    const bg: BackgroundImage | null = image && image.naturalWidth > 0 ? {
      src: image.src,
      xFt: -minX,
      yFt: -minY,
      widthFt: image.naturalWidth * ftPerPixel,
      heightFt: image.naturalHeight * ftPerPixel,
    } : null;

    onSave(normalized, maxX - minX, maxY - minY, bg);
  };

  const pointsToSvgAttr = (pts: Point[]) => pts.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div className="flex h-screen w-full bg-neutral-100">
      <div className="w-72 bg-white border-r p-5 overflow-y-auto shadow-sm flex flex-col gap-5">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Draw Custom Bed Shape</h1>
          <p className="text-xs text-slate-500 mt-1">
            {step === 'scale'
              ? 'Optionally load a top-down photo, then set the scale by matching the bar to a known real-world distance.'
              : 'Trace the bed outline by dragging around its edge.'}
          </p>
        </div>

        {step === 'scale' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer">
                {image ? 'Replace Background Photo' : 'Load Background Photo'}
                <input type="file" accept="image/*" onChange={handleLoadImage} className="hidden" />
              </label>
              {image && (
                <button onClick={handleClearImage} className="block mt-1 text-xs font-semibold text-slate-500 hover:text-slate-700 underline cursor-pointer">
                  Clear Photo
                </button>
              )}
            </div>

            <div>
              <label className="text-xs text-slate-500 block mb-1">Scale bar length (feet)</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={scaleFeet}
                onChange={(e) => setScaleFeet(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <p className="text-[10px] text-slate-400 mt-1 leading-tight">
                Drag the two handles on the canvas so the bar matches a known real-world distance (e.g. a paving slab, a fence panel), then enter that distance here.
              </p>
            </div>

            <button
              onClick={() => setStep('trace')}
              disabled={!canProceedToTrace}
              className="w-full py-2.5 bg-emerald-600 disabled:bg-slate-300 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-md transition-colors"
            >
              Next: Trace Outline →
            </button>
          </div>
        )}

        {step === 'trace' && (
          <div className="flex flex-col gap-3">
            <button onClick={() => setStep('scale')} className="w-full bg-stone-200 hover:bg-stone-300 p-2 rounded text-sm font-semibold">
              ← Back to Scale
            </button>
            <button
              onClick={() => { setOutline(null); setPathPoints([]); }}
              className="w-full bg-stone-200 hover:bg-stone-300 p-2 rounded text-sm font-semibold"
            >
              Redo Outline
            </button>
            <p className="text-[10px] text-slate-400 leading-tight">
              Press and drag around the bed's edge, then release to close the shape.
              {outline && ` Captured ${outline.length} points.`}
            </p>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="w-full mt-2 py-2.5 bg-emerald-600 disabled:bg-slate-300 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-md transition-colors"
            >
              Save Shape
            </button>
          </div>
        )}

        <button onClick={onCancel} className="w-full mt-auto py-2 bg-stone-200 hover:bg-stone-300 rounded text-sm">
          Cancel
        </button>
      </div>

      <div className="flex-1 p-8 flex items-center justify-center">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
          className="bg-stone-200 border-2 border-stone-400 rounded-lg touch-none"
          style={{ width: '100%', maxWidth: `${canvasSize.width}px`, height: 'auto', aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
        >
          {!image && (
            <>
              <defs>
                <pattern id="grid" width={canvasSize.width / 20} height={canvasSize.width / 20} patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="#94a3b8" />
                </pattern>
              </defs>
              <rect x="0" y="0" width={canvasSize.width} height={canvasSize.height} fill="url(#grid)" />
            </>
          )}
          {image && image.naturalWidth > 0 && (
            <image
              href={image.src}
              x="0" y="0"
              width={canvasSize.width}
              height={canvasSize.height}
              preserveAspectRatio="none"
            />
          )}

          {step === 'trace' && pathPoints.length > 0 && (
            outline ? (
              <polygon points={pointsToSvgAttr(outline)} fill="rgba(16,185,129,0.25)" stroke="#059669" strokeWidth={Math.max(canvasSize.width, canvasSize.height) * 0.004} />
            ) : (
              <polyline points={pointsToSvgAttr(pathPoints)} fill="none" stroke="#059669" strokeWidth={Math.max(canvasSize.width, canvasSize.height) * 0.004} />
            )
          )}

          {step === 'scale' && (
            <g>
              <line x1={scaleBar.x1} y1={scaleBar.y1} x2={scaleBar.x2} y2={scaleBar.y2} stroke="#f59e0b" strokeWidth={Math.max(canvasSize.width, canvasSize.height) * 0.005} />
              {(['a', 'b'] as const).map(handle => {
                const [x, y] = handle === 'a' ? [scaleBar.x1, scaleBar.y1] : [scaleBar.x2, scaleBar.y2];
                return (
                  <circle
                    key={handle}
                    cx={x} cy={y}
                    r={Math.max(canvasSize.width, canvasSize.height) * 0.012}
                    fill="#f59e0b"
                    stroke="#78350f"
                    strokeWidth={Math.max(canvasSize.width, canvasSize.height) * 0.002}
                    className="cursor-grab"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
                      setDraggingHandle(handle);
                    }}
                  />
                );
              })}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
