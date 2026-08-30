import React, { useState, useEffect, useRef } from 'react';
import { plantConfig as defaultPlantConfig } from './gardens/butterfly_haven.ts';

export default function App() {
  const [screen, setScreen] = useState('setup');
  const [bedWidth, setBedWidth] = useState(10);
  const [bedHeight, setBedHeight] = useState(10);
  const [overlapPct, setOverlapPct] = useState(0);
  const [plantConfig, setPlantConfig] = useState(defaultPlantConfig);
  const [activePlants, setActivePlants] = useState([]);
  const [draggedId, setDraggedId] = useState(null);
  const containerRef = useRef(null);

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

  const generateLayout = () => {
    let instances = [];
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

  const resolveCollisions = (activeId, currentPlants) => {
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

  const handlePointerMove = (e) => {
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

  if (screen === 'setup') {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Garden Setup (Config: Butterfly Haven)</h1>
        <div className="flex gap-4 mb-4">
          <label>Width (ft): <input type="number" value={bedWidth} onChange={e => setBedWidth(Number(e.target.value))} className="border p-1 w-20" /></label>
          <label>Height (ft): <input type="number" value={bedHeight} onChange={e => setBedHeight(Number(e.target.value))} className="border p-1 w-20" /></label>
          <label>Allowed Overlap (%): <input type="number" value={overlapPct} onChange={e => setOverlapPct(Number(e.target.value))} className="border p-1 w-20" /></label>
        </div>
        <button onClick={generateLayout} className="bg-blue-600 text-white px-4 py-2 rounded">Start Designing</button>
      </div>
    );
  }

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
      <div className="flex-1 p-8 flex items-center justify-center overflow-hidden">
        <div 
          ref={containerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={() => setDraggedId(null)}
          onPointerLeave={() => setDraggedId(null)}
          className="relative bg-stone-200 border-2 border-stone-400"
          style={{ 
            aspectRatio: `${bedWidth} / ${bedHeight}`,
            width: bedWidth >= bedHeight ? '100%' : 'auto',
            height: bedHeight > bedWidth ? '100%' : 'auto',
            maxHeight: '90vh',
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