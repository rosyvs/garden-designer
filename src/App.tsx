import { useState, useEffect, useRef } from 'react';
import type { ChangeEvent, PointerEvent } from 'react';
import { plantConfig as defaultPlantConfig } from './gardens/butterfly_haven.ts';

interface PlantType {
  id: number;
  name: string;
  height: number;
  spread: number;
  shape: string;
  color: string;
  textColor: string;
  defaultSize: number;
  radius: number;
  count: number;
}

interface PlantInstance extends PlantType {
  instanceId: number;
  x: number;
  y: number;
}

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
  const [bedWidth, setBedWidth] = useState(10);
  const [bedHeight, setBedHeight] = useState(10);
  const [overlapPct, setOverlapPct] = useState(0);
  const [plantConfig, setPlantConfig] = useState<PlantType[]>(defaultPlantConfig);
  const [activePlants, setActivePlants] = useState<PlantInstance[]>([]);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const designAreaRef = useRef<HTMLDivElement>(null);
  const [designAreaSize, setDesignAreaSize] = useState({ width: 0, height: 0 });

  // Custom plant type form (setup screen)
  const [customPlantName, setCustomPlantName] = useState('');
  const [customPlantColor, setCustomPlantColor] = useState('#4ade80');
  const [customPlantDiameter, setCustomPlantDiameter] = useState('1.5');
  const [customPlantQty, setCustomPlantQty] = useState('1');

  useEffect(() => {
    const saved = localStorage.getItem('gardenState');
    if (saved) {
      const parsed = JSON.parse(saved);
      setBedWidth(parsed.bedWidth);
      setBedHeight(parsed.bedHeight);
      setOverlapPct(parsed.overlapPct);
      setPlantConfig(parsed.plantConfig || defaultPlantConfig);
      if (parsed.activePlants.length > 0) setActivePlants(parsed.activePlants);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('gardenState', JSON.stringify({
      bedWidth, bedHeight, overlapPct, plantConfig, activePlants
    }));
  }, [bedWidth, bedHeight, overlapPct, plantConfig, activePlants]);

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
    let instances: PlantInstance[] = [];
    let uid = 0;
    plantConfig.forEach(pt => {
      for (let i = 0; i < pt.count; i++) {
        instances.push({
          ...pt,
          instanceId: uid++,
          x: Math.random() * bedWidth,
          y: Math.random() * bedHeight
        });
      }
    });
    setActivePlants(resolveCollisions(null, instances));
    setScreen('design');
  };

  const resolveCollisions = (activeId: number | null, currentPlants: PlantInstance[]): PlantInstance[] => {
    let nodes = [...currentPlants];
    let relaxing = true;
    let loops = 0;
    const allowedOverlapFactor = 1 - (overlapPct / 100);

    while (relaxing && loops < 20) {
      relaxing = false;
      loops++;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minD = (nodes[i].radius + nodes[j].radius) * allowedOverlapFactor;

          if (dist < minD && dist > 0) {
            relaxing = true;
            const overlap = minD - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            
            if (nodes[i].instanceId === activeId) {
              nodes[j].x += nx * overlap;
              nodes[j].y += ny * overlap;
            } else if (nodes[j].instanceId === activeId) {
              nodes[i].x -= nx * overlap;
              nodes[i].y -= ny * overlap;
            } else {
              nodes[i].x -= (nx * overlap) / 2;
              nodes[i].y -= (ny * overlap) / 2;
              nodes[j].x += (nx * overlap) / 2;
              nodes[j].y += (ny * overlap) / 2;
            }
          }
        }
      }
    }
    return nodes;
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggedId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scale = bedWidth / rect.width; 
    const mouseX = (e.clientX - rect.left) * scale;
    const mouseY = (e.clientY - rect.top) * scale;

    setActivePlants(prev => {
      const moved = prev.map(p => 
        p.instanceId === draggedId ? { ...p, x: mouseX, y: mouseY } : p
      );
      return resolveCollisions(draggedId, moved);
    });
  };

  const updatePlantCount = (id: number, count: number) => {
    setPlantConfig(prev => prev.map(p => p.id === id ? { ...p, count: Math.max(0, count) } : p));
  };

  const updatePlantDiameter = (id: number, diameter: string) => {
    const size = Math.max(0.1, parseFloat(diameter) || 0.1);
    setPlantConfig(prev => prev.map(p => p.id === id ? { ...p, radius: size / 2, defaultSize: size, spread: size } : p));
  };

  const handleAddCustomPlantType = () => {
    if (!customPlantName.trim()) return;
    const newId = plantConfig.length > 0 ? Math.max(...plantConfig.map(p => p.id)) + 1 : 1;
    const size = parseFloat(customPlantDiameter) || 1.5;

    setPlantConfig(prev => [...prev, {
      id: newId,
      name: customPlantName,
      color: customPlantColor,
      textColor: getContrastYIQ(customPlantColor),
      height: size,
      spread: size,
      defaultSize: size,
      radius: size / 2,
      shape: 'sphere',
      count: parseInt(customPlantQty) || 1
    }]);

    setCustomPlantName('');
    setCustomPlantDiameter('1.5');
    setCustomPlantQty('1');
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
                </div>
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
              <div className="flex justify-between items-end mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Starting Configuration</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">Diameters are in feet</span>
                  <label className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer">
                    Load Config From File
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={handleLoadConfigFile}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {plantConfig.map((p) => (
                  <div key={p.id} className="flex flex-col bg-slate-50 p-2.5 rounded-lg border border-slate-200 gap-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex shrink-0 items-center justify-center font-bold text-xs shadow-inner"
                        style={{ backgroundColor: p.color, color: p.textColor }}
                      >
                        {p.id}
                      </div>
                      <span className="text-[10px] font-medium leading-tight truncate" title={p.name}>{p.name}</span>
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
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={generateLayout}
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
                    onChange={(e) => setCustomPlantDiameter(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Initial Qty</label>
                <input
                  type="number"
                  min="0"
                  value={customPlantQty}
                  onChange={(e) => setCustomPlantQty(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
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

  const bedRatio = bedWidth / bedHeight;
  const availRatio = designAreaSize.width / designAreaSize.height;
  const fitToAvailableSpace = designAreaSize.width > 0 && designAreaSize.height > 0;
  const boxWidth = fitToAvailableSpace
    ? (availRatio > bedRatio ? designAreaSize.height * bedRatio : designAreaSize.width)
    : 0;
  const boxHeight = fitToAvailableSpace
    ? (availRatio > bedRatio ? designAreaSize.height : designAreaSize.width / bedRatio)
    : 0;

  return (
    <div className="flex h-screen w-full bg-neutral-100">
      <div className="w-64 bg-white border-r p-4 overflow-y-auto shadow-sm">
        <h2 className="font-bold mb-4">Plant Key</h2>
        <button onClick={generateLayout} className="w-full bg-stone-200 p-2 rounded mb-4 text-sm font-semibold">🎲 Randomise Layout</button>
        <button onClick={() => setScreen('setup')} className="w-full bg-stone-200 p-2 rounded mb-6 text-sm">⚙️ Back to Setup</button>
        {plantConfig.map(p => (
          <div key={p.id} className="flex items-center gap-2 mb-2 text-sm">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: p.color, color: p.textColor }}>{p.id}</div>
            <span>{p.name}</span>
          </div>
        ))}
      </div>
      <div ref={designAreaRef} className="flex-1 p-8 flex items-center justify-center overflow-hidden">
        <div
          ref={containerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={() => setDraggedId(null)}
          onPointerLeave={() => setDraggedId(null)}
          className="relative bg-stone-200 border-2 border-stone-400"
          style={{
            width: fitToAvailableSpace ? `${boxWidth}px` : '100%',
            height: fitToAvailableSpace ? `${boxHeight}px` : '100%',
            backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 0)',
            backgroundSize: `${100 / bedWidth}% ${100 / bedHeight}%`
          }}
        >


          {activePlants.map(p => (
            <div
              key={p.instanceId}
              onPointerDown={(e) => { e.stopPropagation(); setDraggedId(p.instanceId); }}
              className="absolute rounded-full border border-stone-800 shadow-sm cursor-grab touch-none flex items-center justify-center font-bold text-xs"
              style={{
                width: `${(p.radius * 2 / bedWidth) * 100}%`,
                height: `${(p.radius * 2 / bedHeight) * 100}%`,
                left: `${((p.x - p.radius) / bedWidth) * 100}%`,
                top: `${((p.y - p.radius) / bedHeight) * 100}%`,
                backgroundColor: p.color,
                color: p.textColor,
                opacity: draggedId === p.instanceId ? 0.6 : 0.9, 
                transition: draggedId === p.instanceId ? 'none' : 'transform 0.1s ease-out'
              }}
            >
              {p.id}
            </div>
          ))}
          {/* {activePlants.p && activePlants.map(p => (
            <div
              key={p.instanceId}
              onPointerDown={(e) => { e.stopPropagation(); setDraggedId(p.instanceId); }}
              className="absolute rounded-full border border-stone-800 shadow-sm cursor-grab touch-none flex items-center justify-center font-bold text-xs"
              style={{
                width: `${(p.radius * 2 / bedWidth) * 100}%`,
                height: `${(p.radius * 2 / bedHeight) * 100}%`,
                left: `${((p.x - p.radius) / bedWidth) * 100}%`,
                top: `${((p.y - p.radius) / bedHeight) * 100}%`,
                backgroundColor: p.color,
                color: p.textColor,
                opacity: draggedId === p.instanceId ? 0.6 : 0.9, 
                transition: draggedId === p.instanceId ? 'none' : 'transform 0.1s ease-out'
              }}
            >
              {p.id}
            </div>
          ))} */}
        </div>
      </div>
    </div>
  );
}