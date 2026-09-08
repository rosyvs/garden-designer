import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import type { ChangeEvent, PointerEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLock, faLockOpen } from '@fortawesome/free-solid-svg-icons';
import { plantConfig as defaultPlantConfig } from './gardens/butterfly_haven.ts';
import { layoutEngines, resolveCollisions, isInBed, sampleRandomPointInBed } from './layoutEngines';
import type { PlantType, PlantInstance, Point } from './layoutEngines';
import type { Garden3DHandle, CameraPreset } from './Garden3D';
import BedShapeEditor from './BedShapeEditor';
import type { BackgroundImage } from './BedShapeEditor';

// three.js is a large dependency (~900KB) — only load it once the user
// actually switches to 3D mode, so the default 2D experience stays light.
const Garden3D = lazy(() => import('./Garden3D'));

// Every *.ts file under src/gardens/ is a selectable preset — drop a new
// file there (exporting `plantConfig`) and it shows up with no other changes.
const presetModules = import.meta.glob<{ plantConfig: PlantType[] }>('./gardens/*.ts', { eager: true });
const presets = Object.entries(presetModules).map(([path, mod]) => {
  const fileName = path.split('/').pop()!.replace(/\.ts$/, '');
  const label = fileName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { id: fileName, label, plantConfig: mod.plantConfig };
});

// Read once at module load (not in an effect): loading state via setState calls
// inside a mount effect races the save effect, which fires in the same pass
// with the stale (default) closure and can clobber a real saved garden back
// to defaults before the load ever takes hold — especially under StrictMode's
// dev-mode double effect invocation.
const savedGardenState = (() => {
  try {
    const raw = localStorage.getItem('gardenState');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
})();

const getContrastYIQ = (hexcolor: string) => {
  if (!hexcolor) return '#000';
  const hex = hexcolor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16) || 0;
  const g = parseInt(hex.substr(2, 2), 16) || 0;
  const b = parseInt(hex.substr(4, 2), 16) || 0;
  return (((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128) ? '#000' : '#fff';
};

export default function App() {
  const [screen, setScreen] = useState('setup');
  const [bedWidth, setBedWidth] = useState(() => savedGardenState?.bedWidth ?? 10);
  const [bedHeight, setBedHeight] = useState(() => savedGardenState?.bedHeight ?? 10);
  const [bedPolygon, setBedPolygon] = useState<Point[] | null>(() => savedGardenState?.bedPolygon ?? null);
  const [backgroundImage, setBackgroundImage] = useState<BackgroundImage | null>(() => savedGardenState?.backgroundImage ?? null);
  const [overlapPct, setOverlapPct] = useState(() => savedGardenState?.overlapPct ?? 0);
  const [plantConfig, setPlantConfig] = useState<PlantType[]>(() => savedGardenState?.plantConfig || defaultPlantConfig);
  const [activePlants, setActivePlants] = useState<PlantInstance[]>(() => savedGardenState?.activePlants ?? []);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [selectedEngineId, setSelectedEngineId] = useState(() => savedGardenState?.selectedEngineId || layoutEngines[0].id);
  const [engineParams, setEngineParams] = useState<Record<string, number>>(() => savedGardenState?.engineParams ?? {});
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? '');
  const containerRef = useRef<HTMLDivElement>(null);
  const designAreaRef = useRef<HTMLDivElement>(null);
  const [designAreaSize, setDesignAreaSize] = useState({ width: 0, height: 0 });
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const garden3DRef = useRef<Garden3DHandle>(null);
  const stepAnimRef = useRef<number | null>(null);

  // Custom plant type form (setup screen)
  const [customPlantName, setCustomPlantName] = useState('');
  const [customPlantColor, setCustomPlantColor] = useState('#4ade80');
  const [customPlantDiameter, setCustomPlantDiameter] = useState('1.5');
  const [customPlantHeight, setCustomPlantHeight] = useState('1.5');
  const [customPlantHeightTouched, setCustomPlantHeightTouched] = useState(false);
  const [customPlantShape, setCustomPlantShape] = useState<'sphere' | 'cone' | 'cylinder'>('sphere');
  const [customPlantQty, setCustomPlantQty] = useState('1');
  const [customPlantImage, setCustomPlantImage] = useState<string | null>(null);
  const [customPlantOpacity, setCustomPlantOpacity] = useState('100');

  useEffect(() => {
    localStorage.setItem('gardenState', JSON.stringify({
      bedWidth, bedHeight, bedPolygon, backgroundImage, overlapPct, plantConfig, activePlants, selectedEngineId, engineParams
    }));
  }, [bedWidth, bedHeight, bedPolygon, backgroundImage, overlapPct, plantConfig, activePlants, selectedEngineId, engineParams]);

  // Track the actual available space for the design area so the bed can be
  // sized in pixels to exactly match bedWidth:bedHeight (percentage + max-height
  // CSS breaks the aspect ratio and turns the plant circles into ellipses once
  // the pane gets short, e.g. in an embedded webview).
  useEffect(() => {
    const el = designAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDesignAreaSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [screen]);

  const generateLayout = () => {
    const engine = layoutEngines.find(e => e.id === selectedEngineId) ?? layoutEngines[0];
    const resolvedParams: Record<string, number> = {};
    engine.getParamDefs(plantConfig).forEach(def => {
      resolvedParams[def.key] = engineParams[def.key] ?? def.default;
    });
    // Locked plants keep their position across regeneration, but their type-level
    // properties (diameter, color, height, shape) are re-synced from the current
    // roster — otherwise editing a plant type on the Setup screen would silently
    // leave already-locked instances stuck at whatever size/color they had when
    // they were first placed.
    const lockedPlants = activePlants
      .filter(p => p.locked)
      .map(p => {
        const currentType = plantConfig.find(pt => pt.id === p.id);
        return currentType ? { ...p, ...currentType, id: p.id, instanceId: p.instanceId, x: p.x, y: p.y, locked: p.locked } : p;
      });
    setActivePlants(engine.generate(plantConfig, bedWidth, bedHeight, bedPolygon, overlapPct, resolvedParams, lockedPlants));
    setScreen('design');
  };

  // Applies roster edits (count/diameter/color/shape/image/opacity, deleted
  // types) to the existing arrangement without rescattering anything that's
  // already placed — unlike generateLayout/"Randomise Layout", which is the
  // deliberate full-reshuffle action. Existing instances keep their position;
  // only the count delta is added (new instances placed in free space) or
  // removed (unlocked ones trimmed first).
  const syncActivePlantsToRoster = () => {
    const validIds = new Set(plantConfig.map(pt => pt.id));
    let uid = activePlants.reduce((m, p) => Math.max(m, p.instanceId + 1), 0);

    let next: PlantInstance[] = activePlants
      .filter(p => validIds.has(p.id))
      .map(p => {
        const type = plantConfig.find(pt => pt.id === p.id)!;
        return { ...type, instanceId: p.instanceId, x: p.x, y: p.y, locked: p.locked };
      });

    plantConfig.forEach(pt => {
      const current = next.filter(p => p.id === pt.id);
      if (current.length > pt.count) {
        const excess = current.length - pt.count;
        const removable = current.filter(p => !p.locked).slice(0, excess).map(p => p.instanceId);
        const toRemove = new Set(removable);
        next = next.filter(p => !toRemove.has(p.instanceId));
      } else if (current.length < pt.count) {
        for (let i = 0; i < pt.count - current.length; i++) {
          const point = findFreePoint(next, pt.radius);
          next.push({ ...pt, instanceId: uid++, x: point.x, y: point.y });
        }
      }
    });

    setActivePlants(next);
    setScreen('design');
  };

  // Samples a handful of random candidate points and keeps the one with the
  // least overlap against already-placed plants — used only for inserting
  // newly-added roster counts, so existing plants never get nudged.
  const findFreePoint = (existing: PlantInstance[], radius: number): Point => {
    let best: Point = sampleRandomPointInBed(bedWidth, bedHeight, bedPolygon);
    let bestOverlap = Infinity;
    for (let i = 0; i < 30; i++) {
      const candidate = sampleRandomPointInBed(bedWidth, bedHeight, bedPolygon);
      const overlap = existing.reduce((sum, p) => {
        const dist = Math.hypot(p.x - candidate.x, p.y - candidate.y);
        const minD = p.radius + radius;
        return sum + Math.max(0, minD - dist);
      }, 0);
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        best = candidate;
        if (overlap === 0) break;
      }
    }
    return best;
  };

  // Setup screen's "Generate Design Layout": the first-ever layout uses the
  // selected engine's full scatter, but once an arrangement already exists,
  // roster edits should only apply their diff (see syncActivePlantsToRoster).
  const proceedToDesign = () => {
    if (activePlants.length === 0) {
      generateLayout();
    } else {
      syncActivePlantsToRoster();
    }
  };

  const deletePlantType = (id: number) => {
    setPlantConfig(prev => prev.filter(p => p.id !== id));
  };

  const toggleLock = (instanceId: number) => {
    setActivePlants(prev => prev.map(p =>
      p.instanceId === instanceId ? { ...p, locked: !p.locked } : p
    ));
  };

  const stopIsingStepping = () => {
    if (stepAnimRef.current !== null) {
      cancelAnimationFrame(stepAnimRef.current);
      stepAnimRef.current = null;
    }
  };

  const startIsingStepping = () => {
    const engine = layoutEngines.find(e => e.id === selectedEngineId) ?? layoutEngines[0];
    if (!engine.step) return;
    const resolvedParams: Record<string, number> = {};
    engine.getParamDefs(plantConfig).forEach(def => {
      resolvedParams[def.key] = engineParams[def.key] ?? def.default;
    });

    // Run several proposals per rendered frame so the dynamics visibly
    // advance faster while held, without dropping below a smooth frame rate.
    const stepsPerFrame = 8;
    const tick = () => {
      setActivePlants(prev => {
        let next = prev;
        for (let i = 0; i < stepsPerFrame; i++) {
          next = engine.step!(next, bedWidth, bedHeight, bedPolygon, overlapPct, resolvedParams);
        }
        return next;
      });
      stepAnimRef.current = requestAnimationFrame(tick);
    };
    stepAnimRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => stopIsingStepping, []);

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (draggedId === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scale = bedWidth / rect.width;
    const mouseX = (e.clientX - rect.left) * scale;
    const mouseY = (e.clientY - rect.top) * scale;

    setActivePlants(prev => {
      const moved = prev.map(p =>
        p.instanceId === draggedId && !p.locked ? { ...p, x: mouseX, y: mouseY } : p
      );
      return resolveCollisions(draggedId, moved, overlapPct);
    });
  };

  const updatePlantCount = (id: number, count: number) => {
    setPlantConfig(prev => prev.map(p => p.id === id ? { ...p, count: Math.max(0, count) } : p));
  };

  const updatePlantDiameter = (id: number, diameter: string) => {
    const size = Math.max(0.1, parseFloat(diameter) || 0.1);
    setPlantConfig(prev => prev.map(p => p.id === id ? { ...p, radius: size / 2, defaultSize: size, spread: size } : p));
  };

  const updatePlantHeight = (id: number, height: string) => {
    const size = Math.max(0.1, parseFloat(height) || 0.1);
    setPlantConfig(prev => prev.map(p => p.id === id ? { ...p, height: size } : p));
  };

  const updatePlantShape = (id: number, shape: string) => {
    setPlantConfig(prev => prev.map(p => p.id === id ? { ...p, shape } : p));
  };

  const updatePlantOpacity = (id: number, opacityPct: number) => {
    setPlantConfig(prev => prev.map(p => p.id === id ? { ...p, opacity: Math.min(100, Math.max(0, opacityPct)) / 100 } : p));
  };

  const updatePlantImage = (id: number, image: string | null) => {
    setPlantConfig(prev => prev.map(p => p.id === id ? { ...p, image: image ?? undefined } : p));
  };

  const readImageFile = (file: File, onLoad: (dataUrl: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => onLoad(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleAddCustomPlantType = () => {
    if (!customPlantName.trim()) return;
    const newId = plantConfig.length > 0 ? Math.max(...plantConfig.map(p => p.id)) + 1 : 1;
    const size = parseFloat(customPlantDiameter) || 1.5;
    const height = parseFloat(customPlantHeight) || size;

    setPlantConfig(prev => [...prev, {
      id: newId,
      name: customPlantName,
      color: customPlantColor,
      textColor: getContrastYIQ(customPlantColor),
      height,
      spread: size,
      defaultSize: size,
      radius: size / 2,
      shape: customPlantShape,
      count: parseInt(customPlantQty) || 1,
      image: customPlantImage ?? undefined,
      opacity: (parseFloat(customPlantOpacity) || 100) / 100,
    }]);

    setCustomPlantName('');
    setCustomPlantDiameter('1.5');
    setCustomPlantHeight('1.5');
    setCustomPlantHeightTouched(false);
    setCustomPlantShape('sphere');
    setCustomPlantQty('1');
    setCustomPlantImage(null);
    setCustomPlantOpacity('100');
  };

  const handleLoadConfigFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!Array.isArray(parsed)) throw new Error('expected a JSON array of plant types');
        setPlantConfig(parsed);
      } catch (err) {
        alert(`Could not load config file: ${err instanceof Error ? err.message : 'invalid JSON'}`);
      }
    };
    reader.readAsText(file);
  };

  const handleApplyPreset = (mode: 'add' | 'replace') => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (!preset) return;

    if (mode === 'replace') {
      setPlantConfig(preset.plantConfig.map(p => ({ ...p })));
      return;
    }

    setPlantConfig(prev => {
      const next = prev.map(p => ({ ...p }));
      let nextId = next.length > 0 ? Math.max(...next.map(p => p.id)) + 1 : 1;
      preset.plantConfig.forEach(presetPlant => {
        const existing = next.find(p => p.name.toLowerCase() === presetPlant.name.toLowerCase());
        if (existing) {
          existing.count += presetPlant.count;
        } else {
          next.push({ ...presetPlant, id: nextId++ });
        }
      });
      return next;
    });
  };

  const handleExportConfig = () => {
    const blob = new Blob([JSON.stringify(plantConfig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'garden-config.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (screen === 'setup') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-800 p-4 md:p-6 overflow-y-auto">
        <div className="max-w-5xl w-full bg-white rounded-xl shadow-lg border border-slate-200 my-auto flex flex-col lg:flex-row overflow-hidden">

          <div className="flex-1 p-6 md:p-8 flex flex-col gap-8 lg:border-r border-slate-100">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Garden Setup</h1>
              <p className="text-sm text-slate-500 mt-1">Configure dimensions and starting plants (edits are automatically remembered)</p>
            </div>

            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Bed Dimensions (Feet)</h2>
                {bedPolygon ? (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600">
                      Custom shape — bounding box {bedWidth.toFixed(1)} × {bedHeight.toFixed(1)} ft
                    </div>
                    <button
                      onClick={() => setScreen('shape-editor')}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer whitespace-nowrap"
                    >
                      Edit Shape
                    </button>
                    <button
                      onClick={() => { setBedPolygon(null); setBackgroundImage(null); }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700 underline cursor-pointer whitespace-nowrap"
                    >
                      Revert to Rectangle
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className="text-xs text-slate-500 block mb-1">Width (X)</label>
                      <input
                        type="number"
                        value={bedWidth}
                        onChange={(e) => setBedWidth(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                    <span className="text-slate-400 mt-5">×</span>
                    <div className="flex-1">
                      <label className="text-xs text-slate-500 block mb-1">Height (Y)</label>
                      <input
                        type="number"
                        value={bedHeight}
                        onChange={(e) => setBedHeight(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                    <button
                      onClick={() => setScreen('shape-editor')}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer whitespace-nowrap self-end mb-2.5"
                    >
                      ✏️ Draw Custom Shape
                    </button>
                  </div>
                )}
              </div>
              <div className="w-full md:w-48">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Collision Logic</h2>
                <label className="text-xs text-slate-500 block mb-1">Allowed Overlap (%)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0" max="80"
                    value={overlapPct}
                    onChange={(e) => setOverlapPct(Number(e.target.value))}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="text-sm font-bold text-slate-700 w-8">{overlapPct}%</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1 leading-tight">Increase if plants get pushed out of the bed.</p>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Plant Roster</h2>
              <div className="flex flex-col md:flex-row justify-between md:items-center gap-3 mb-3">
                {presets.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className="text-xs text-slate-500">Preset Garden:</label>
                    <select
                      value={selectedPresetId}
                      onChange={(e) => setSelectedPresetId(e.target.value)}
                      className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-emerald-500 outline-none"
                    >
                      {presets.map(preset => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleApplyPreset('add')}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer"
                    >
                      Add Plants
                    </button>
                    <button
                      onClick={() => handleApplyPreset('replace')}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer"
                    >
                      Start over with preset
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer">
                    Load preset from file
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={handleLoadConfigFile}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={handleExportConfig}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer"
                  >
                    💾 Save Roster to File
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {plantConfig.map((p) => (
                  <div key={p.id} className="relative flex flex-col bg-slate-50 p-2.5 rounded-lg border border-slate-200 gap-2">
                    <button
                      type="button"
                      onClick={() => deletePlantType(p.id)}
                      title="Delete plant type"
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-stone-400 shadow flex items-center justify-center text-[9px] leading-none text-slate-500 hover:text-red-600 hover:border-red-400 cursor-pointer"
                    >
                      ✕
                    </button>
                    <div className="flex items-center gap-2">
                      <label
                        className="w-7 h-7 rounded-full flex shrink-0 items-center justify-center font-bold text-xs shadow-inner cursor-pointer bg-cover bg-center"
                        style={{ backgroundColor: p.color, color: p.textColor, backgroundImage: p.image ? `url(${p.image})` : undefined }}
                        title="Click to set a fill image"
                      >
                        {!p.image && p.id}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) readImageFile(file, (dataUrl) => updatePlantImage(p.id, dataUrl));
                          }}
                        />
                      </label>
                      <span className="text-[10px] font-medium leading-tight truncate flex-1" title={p.name}>{p.name}</span>
                      {p.image && (
                        <button
                          type="button"
                          onClick={() => updatePlantImage(p.id, null)}
                          className="text-[9px] text-slate-400 hover:text-red-600 cursor-pointer"
                          title="Remove image"
                        >
                          clear img
                        </button>
                      )}
                    </div>

                    <div className="w-full space-y-1.5 mt-1">
                      <div className="flex items-center justify-between text-xs">
                        <label className="text-slate-500">Qty:</label>
                        <input
                          type="number"
                          min="0"
                          value={p.count}
                          onChange={(e) => updatePlantCount(p.id, parseInt(e.target.value) || 0)}
                          className="w-12 text-center border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <label className="text-slate-500">Dia(ft):</label>
                        <input
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={p.radius * 2}
                          onChange={(e) => updatePlantDiameter(p.id, e.target.value)}
                          className="w-12 text-center border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <label className="text-slate-500">Height(ft):</label>
                        <input
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={p.height}
                          onChange={(e) => updatePlantHeight(p.id, e.target.value)}
                          className="w-12 text-center border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <label className="text-slate-500">Shape:</label>
                        <select
                          value={p.shape === 'cone' || p.shape === 'cylinder' ? p.shape : 'sphere'}
                          onChange={(e) => updatePlantShape(p.id, e.target.value)}
                          className="w-20 text-center border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                        >
                          <option value="sphere">Ellipse</option>
                          <option value="cone">Cone</option>
                          <option value="cylinder">Cylinder</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <label className="text-slate-500">Opacity:</label>
                        <div className="flex items-center gap-1 w-16">
                          <input
                            type="range"
                            min="10" max="100"
                            value={Math.round((p.opacity ?? 1) * 100)}
                            onChange={(e) => updatePlantOpacity(p.id, Number(e.target.value))}
                            className="flex-1 accent-emerald-600"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={proceedToDesign}
              className="w-full mt-auto py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-md transition-colors"
            >
              Generate Design Layout
            </button>
          </div>

          <div className="w-full lg:w-80 bg-slate-50 p-6 md:p-8 flex flex-col gap-4 border-t lg:border-t-0 lg:border-l border-slate-200">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-1">Add Custom Plant Type</h2>

            <div className="space-y-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Plant Name</label>
                <input
                  type="text"
                  value={customPlantName}
                  onChange={(e) => setCustomPlantName(e.target.value)}
                  placeholder="e.g. Lavender"
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Color</label>
                  <input
                    type="color"
                    value={customPlantColor}
                    onChange={(e) => setCustomPlantColor(e.target.value)}
                    className="w-full h-8 bg-slate-50 border border-slate-300 rounded cursor-pointer"
                  />
                </div>
                <div className="w-20">
                  <label className="text-xs text-slate-500 block mb-1">Dia(ft)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={customPlantDiameter}
                    onChange={(e) => {
                      setCustomPlantDiameter(e.target.value);
                      if (!customPlantHeightTouched) setCustomPlantHeight(e.target.value);
                    }}
                    className="w-full px-2 py-1 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Height (ft)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={customPlantHeight}
                    onChange={(e) => {
                      setCustomPlantHeightTouched(true);
                      setCustomPlantHeight(e.target.value);
                    }}
                    className="w-full px-2 py-1 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="w-24">
                  <label className="text-xs text-slate-500 block mb-1">Shape</label>
                  <select
                    value={customPlantShape}
                    onChange={(e) => setCustomPlantShape(e.target.value === 'cone' || e.target.value === 'cylinder' ? e.target.value : 'sphere')}
                    className="w-full px-2 py-1 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="sphere">Ellipse</option>
                    <option value="cone">Cone</option>
                    <option value="cylinder">Cylinder</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Initial Qty</label>
                  <input
                    type="number"
                    min="0"
                    value={customPlantQty}
                    onChange={(e) => setCustomPlantQty(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Opacity (%)</label>
                  <input
                    type="number"
                    min="10" max="100"
                    value={customPlantOpacity}
                    onChange={(e) => setCustomPlantOpacity(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer">
                  {customPlantImage ? 'Replace Fill Image' : 'Load Fill Image (optional)'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) readImageFile(file, setCustomPlantImage);
                    }}
                  />
                </label>
                {customPlantImage && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-8 h-8 rounded-full bg-cover bg-center border border-slate-300" style={{ backgroundImage: `url(${customPlantImage})` }} />
                    <button onClick={() => setCustomPlantImage(null)} className="text-[10px] text-slate-400 hover:text-red-600 cursor-pointer">clear image</button>
                  </div>
                )}
              </div>
              <button
                onClick={handleAddCustomPlantType}
                disabled={!customPlantName.trim()}
                className="w-full mt-2 py-2 bg-slate-800 disabled:bg-slate-300 hover:bg-slate-900 text-white text-sm font-bold rounded transition-colors"
              >
                Add to Roster
              </button>
            </div>
          </div>

        </div>
      </div>
    );
  }

  if (screen === 'shape-editor') {
    return (
      <BedShapeEditor
        initialPolygon={bedPolygon}
        initialBackgroundImage={backgroundImage}
        onCancel={() => setScreen('setup')}
        onSave={(polygon, width, height, image) => {
          setBedPolygon(polygon);
          setBedWidth(width);
          setBedHeight(height);
          setBackgroundImage(image);
          setScreen('setup');
        }}
      />
    );
  }

  // Reserve a margin around the bed (at least double the largest plant's
  // diameter) so there's room to drag plants outside the box while
  // rearranging, without them immediately hitting the edge of the pane.
  const largestDiameter = plantConfig.reduce((max, p) => Math.max(max, p.radius * 2), 0);
  const padFeet = largestDiameter * 2;
  const effWidth = bedWidth + 2 * padFeet;
  const effHeight = bedHeight + 2 * padFeet;
  const effRatio = effWidth / effHeight;
  const availRatio = designAreaSize.width / designAreaSize.height;
  const fitToAvailableSpace = designAreaSize.width > 0 && designAreaSize.height > 0;
  const effBoxWidth = fitToAvailableSpace
    ? (availRatio > effRatio ? designAreaSize.height * effRatio : designAreaSize.width)
    : 0;
  const effBoxHeight = fitToAvailableSpace
    ? (availRatio > effRatio ? designAreaSize.height : designAreaSize.width / effRatio)
    : 0;
  const scale = fitToAvailableSpace ? effBoxWidth / effWidth : 0;
  const padPx = padFeet * scale;
  const plantsOutOfBounds = activePlants.some(p => !p.locked && !isInBed(p.x, p.y, bedWidth, bedHeight, bedPolygon));
  const currentEngine = layoutEngines.find(e => e.id === selectedEngineId) ?? layoutEngines[0];
  const currentParamDefs = currentEngine.getParamDefs(plantConfig);

  return (
    <div className="flex h-screen w-full bg-neutral-100">
      <div className="w-64 bg-white border-r p-4 overflow-y-auto shadow-sm">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">View</label>
        <div className="flex bg-slate-100 rounded-lg p-1 mb-4 text-sm font-semibold">
          <button
            onClick={() => setViewMode('2d')}
            className={`flex-1 py-1 rounded-md transition-colors ${viewMode === '2d' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
          >
            2D
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`flex-1 py-1 rounded-md transition-colors ${viewMode === '3d' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
          >
            3D
          </button>
        </div>

        {viewMode === '3d' && (
          <div className="mb-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">Camera</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['isometric', 'top', 'front', 'reset'] as CameraPreset[]).map(preset => (
                <button
                  key={preset}
                  onClick={() => garden3DRef.current?.setView(preset)}
                  className="bg-stone-200 hover:bg-stone-300 rounded py-1 text-xs font-semibold capitalize"
                >
                  {preset}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1 leading-tight">Drag to orbit, scroll to zoom, right-drag to pan. Click the axis cube to snap views.</p>
          </div>
        )}

        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">Layout Engine</label>
        <select
          value={selectedEngineId}
          onChange={(e) => setSelectedEngineId(e.target.value)}
          className="w-full px-2 py-1.5 mb-1 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
        >
          {layoutEngines.map(engine => (
            <option key={engine.id} value={engine.id}>{engine.label}</option>
          ))}
        </select>
        <p className="text-[10px] text-slate-400 mb-3 leading-tight">
          {layoutEngines.find(e => e.id === selectedEngineId)?.description}
        </p>

        <button onClick={generateLayout} className="w-full bg-stone-200 p-2 rounded mb-4 text-sm font-semibold">🎲 Randomise Layout</button>
        <button onClick={() => setScreen('setup')} className="w-full bg-stone-200 p-2 rounded mb-4 text-sm">⚙️ Back to Setup</button>
        <button onClick={handleExportConfig} className="w-full bg-stone-200 p-2 rounded mb-6 text-sm">💾 Export Config</button>

        {currentParamDefs.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Engine Parameters</h2>
            {currentParamDefs.map(def => {
              const value = engineParams[def.key] ?? def.default;
              return (
                <div key={def.key} className="mb-3">
                  <label className="text-xs text-slate-500 block mb-1">{def.label}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={value}
                      onChange={(e) => setEngineParams(prev => ({ ...prev, [def.key]: Number(e.target.value) }))}
                      className="flex-1 accent-emerald-600"
                    />
                    <span className="text-sm font-bold text-slate-700 w-10 text-right">{value}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {currentEngine.step && (
          <button
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              startIsingStepping();
            }}
            onPointerUp={stopIsingStepping}
            onPointerCancel={stopIsingStepping}
            className="w-full bg-stone-200 active:bg-stone-300 p-2 rounded mb-6 text-sm font-semibold select-none touch-none"
          >
            🌀 Hold to Animate Dynamics
          </button>
        )}

        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">Plant Key</label>
        {plantConfig.map(p => (
          <div key={p.id} className="flex items-center gap-2 mb-2 text-sm">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-cover bg-center"
              style={{ backgroundColor: p.color, color: p.textColor, backgroundImage: p.image ? `url(${p.image})` : undefined }}
            >
              {!p.image && p.id}
            </div>
            <span>{p.name}</span>
          </div>
        ))}
      </div>
      <div ref={designAreaRef} className="flex-1 p-8 flex items-center justify-center">
        {viewMode === '3d' ? (
          <div className="w-full h-full flex flex-col">
            <div className="flex-1 rounded-lg overflow-hidden border-2 border-stone-400 bg-stone-100">
              <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-sm text-slate-400">Loading 3D view…</div>}>
                <Garden3D ref={garden3DRef} bedWidth={bedWidth} bedHeight={bedHeight} bedPolygon={bedPolygon} activePlants={activePlants} />
              </Suspense>
            </div>
            <p className={`text-xs text-right text-amber-600 mt-1 transition-opacity ${plantsOutOfBounds ? 'opacity-100' : 'opacity-0'}`}>
              plants not within garden
            </p>
          </div>
        ) : (
          <div className="flex flex-col" style={{ width: fitToAvailableSpace ? `${effBoxWidth}px` : '100%' }}>
            <div
              className="relative"
              style={{
                width: fitToAvailableSpace ? `${effBoxWidth}px` : '100%',
                height: fitToAvailableSpace ? `${effBoxHeight}px` : '100%',
                padding: fitToAvailableSpace ? `${padPx}px` : 0,
                boxSizing: 'border-box',
              }}
            >
              {/* Full-bleed backdrop photo, spanning the padded margin as well as the
                  bed itself — the bed fill/border below is made transparent so this
                  shows through the whole arrangement screen, not just the bed outline. */}
              {backgroundImage && (
                <img
                  src={backgroundImage.src}
                  alt=""
                  className="absolute pointer-events-none select-none"
                  style={{
                    left: `${((backgroundImage.xFt + padFeet) / effWidth) * 100}%`,
                    top: `${((backgroundImage.yFt + padFeet) / effHeight) * 100}%`,
                    width: `${(backgroundImage.widthFt / effWidth) * 100}%`,
                    height: `${(backgroundImage.heightFt / effHeight) * 100}%`,
                  }}
                />
              )}
              <div
                ref={containerRef}
                className={`relative w-full h-full ${backgroundImage ? 'bg-stone-200/40' : 'bg-stone-200'} ${bedPolygon ? '' : `border-2 ${backgroundImage ? 'border-transparent' : 'border-stone-400'}`}`}
              >
                {/* Clipped to the bed's true outline — the dot grid is backdrop
                    only, so only this layer (not the plants below) is masked. */}
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{
                    backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 0)',
                    backgroundSize: `${100 / bedWidth}% ${100 / bedHeight}%`,
                    clipPath: bedPolygon
                      ? `polygon(${bedPolygon.map(v => `${(v.x / bedWidth) * 100}% ${(v.y / bedHeight) * 100}%`).join(', ')})`
                      : undefined,
                  }}
                />
                {bedPolygon && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${bedWidth} ${bedHeight}`}
                    preserveAspectRatio="none"
                  >
                    <polygon
                      points={bedPolygon.map(v => `${v.x},${v.y}`).join(' ')}
                      fill="none"
                      stroke={backgroundImage ? 'transparent' : '#78716c'}
                      strokeWidth={Math.max(bedWidth, bedHeight) * 0.06}
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
                {activePlants.map(p => {
                  const isOutOfBounds = !p.locked && !isInBed(p.x, p.y, bedWidth, bedHeight, bedPolygon);
                  return (
                  <div
                    key={p.instanceId}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (p.locked) return;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDraggedId(p.instanceId);
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={() => setDraggedId(null)}
                    // z-index rises on hover (and stays modestly raised while
                    // locked) so a plant's own corner badge — which pokes just
                    // outside its circle — always paints above a neighboring,
                    // later-in-DOM plant that would otherwise cover it.
                    className={`group absolute rounded-full shadow-sm touch-none flex items-center justify-center font-bold text-xs hover:z-30 bg-cover bg-center ${p.locked ? 'z-10' : 'z-0'} ${p.locked ? 'cursor-not-allowed' : 'cursor-grab'} ${isOutOfBounds ? 'border-2 border-red-600' : 'border border-stone-800'}`}
                    style={{
                      width: `${(p.radius * 2 / bedWidth) * 100}%`,
                      height: `${(p.radius * 2 / bedHeight) * 100}%`,
                      left: `${((p.x - p.radius) / bedWidth) * 100}%`,
                      top: `${((p.y - p.radius) / bedHeight) * 100}%`,
                      backgroundColor: p.color,
                      backgroundImage: p.image ? `url(${p.image})` : undefined,
                      color: p.textColor,
                      opacity: (draggedId === p.instanceId ? 0.6 : 0.9) * (p.opacity ?? 1),
                      transition: draggedId === p.instanceId ? 'none' : 'transform 0.1s ease-out'
                    }}
                  >
                    {p.id}
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLock(p.instanceId);
                      }}
                      className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-stone-400 shadow flex items-center justify-center text-[8px] leading-none cursor-pointer transition-opacity ${p.locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      title={p.locked ? 'Unlock position' : 'Lock position'}
                    >
                      <FontAwesomeIcon icon={p.locked ? faLock : faLockOpen} />
                    </button>
                  </div>
                  );
                })}
              </div>
            </div>
            <p className={`text-xs text-right text-amber-600 mt-1 transition-opacity ${plantsOutOfBounds ? 'opacity-100' : 'opacity-0'}`}>
              plants not within garden
            </p>
          </div>
        )}
      </div>
    </div>
  );
}